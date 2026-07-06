import crypto from 'crypto';
import { Queue, type QueueOptions } from 'bullmq';

import { AutomationAuthError, type AutomationCaller } from '@/lib/automation/auth';
import { prisma } from '@/lib/db';
import {
  getAutomationJobDefinition,
  type AutomationJobName,
} from './definitions';
import { getJobQueuePrefix, getJobRedisConnection } from './connection';
import { submitAutomationJob, type QueueLike, type QueuedAutomationJob } from './submit';
import type { JobLockRedis } from './locks';
import type { JobRateLimitRedis } from './rate-limit';
import { AUTOMATION_QUEUE_NAME } from './definitions';

export type AutomationRunRetryRow = {
  id: string;
  workflow: string;
  step: string;
  status: string;
};

export type RetryQueueJob = {
  data?: unknown;
  getState?: () => Promise<string>;
};

export type RetryQueue = QueueLike & {
  getJob: (jobId: string) => Promise<RetryQueueJob | null | undefined>;
  close?: () => Promise<void>;
};

export type RetriedAutomationJob = QueuedAutomationJob & {
  retryOfRunId: string;
};

type RetryAutomationRunDeps = {
  automationRuns?: {
    findUnique: (args: unknown) => Promise<AutomationRunRetryRow | null>;
  };
  queue?: RetryQueue;
  redis?: JobLockRedis & JobRateLimitRedis;
  prefix?: string;
  submitJob?: typeof submitAutomationJob;
};

export class JobRetryError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'JobRetryError';
  }
}

export async function retryAutomationRun(
  input: {
    runId: string;
    caller: AutomationCaller;
    idempotencyKey: string;
  },
  deps: RetryAutomationRunDeps = {}
): Promise<RetriedAutomationJob> {
  const automationRuns = deps.automationRuns ?? prisma.automation_runs;
  const run = await automationRuns.findUnique({
    where: { id: input.runId },
    select: {
      id: true,
      workflow: true,
      step: true,
      status: true,
    },
  });

  if (!run) {
    throw new JobRetryError('JOB_NOT_FOUND', 'Automation job was not found', 404);
  }
  if (run.status !== 'failed') {
    throw new JobRetryError('JOB_NOT_RETRYABLE', 'Only failed automation jobs can be retried', 409, {
      status: run.status,
    });
  }

  const jobName = jobNameForRun(run);
  const definition = getAutomationJobDefinition(jobName);
  if (!input.caller.scopes.includes(definition.scope)) {
    throw new AutomationAuthError('AUTOMATION_SCOPE_FORBIDDEN', 'Automation token scope is not allowed', 403);
  }

  const queue = deps.queue ?? createAutomationRetryQueue();
  const shouldCloseQueue = !deps.queue;

  try {
    const originalJob = await queue.getJob(input.runId);
    const payload = extractRetryPayload(originalJob?.data);
    const retried = await (deps.submitJob ?? submitAutomationJob)({
      caller: input.caller,
      jobName,
      idempotencyKey: buildRetryIdempotencyKey(input.runId, input.idempotencyKey),
      payload,
    }, {
      queue,
      redis: deps.redis,
      prefix: deps.prefix,
    });

    return {
      ...retried,
      retryOfRunId: input.runId,
    };
  } finally {
    if (shouldCloseQueue) {
      await queue.close?.().catch(() => undefined);
    }
  }
}

export function buildRetryIdempotencyKey(runId: string, idempotencyKey: string): string {
  const digest = crypto.createHash('sha256').update(idempotencyKey, 'utf8').digest('hex').slice(0, 24);
  return `retry:${runId}:${digest}`;
}

export function createAutomationRetryQueue(): RetryQueue {
  return new Queue(AUTOMATION_QUEUE_NAME, {
    connection: getJobRedisConnection() as unknown as QueueOptions['connection'],
    prefix: getJobQueuePrefix(),
  }) as unknown as RetryQueue;
}

function jobNameForRun(run: { workflow: string; step: string }): AutomationJobName {
  if (run.workflow === 'sync' && run.step === 'run') return 'sync.run';
  if (run.workflow === 'score' && run.step === 'run') return 'score.run';
  if (run.workflow === 'weekly' && run.step === 'publish') return 'weekly.publish';

  throw new JobRetryError('JOB_RETRY_UNSUPPORTED', 'This automation job type cannot be retried yet', 409, {
    workflow: run.workflow,
    step: run.step,
  });
}

function extractRetryPayload(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object') {
    throw new JobRetryError('RETRY_PAYLOAD_UNAVAILABLE', 'Original job payload is no longer retained', 409);
  }

  const payload = (data as { payload?: unknown }).payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new JobRetryError('RETRY_PAYLOAD_UNAVAILABLE', 'Original job payload is no longer retained', 409);
  }

  return payload as Record<string, unknown>;
}
