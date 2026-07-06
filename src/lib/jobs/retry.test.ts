// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AutomationCaller } from '@/lib/automation/auth';
import {
  buildRetryIdempotencyKey,
  JobRetryError,
  retryAutomationRun,
  type AutomationRunRetryRow,
  type RetryQueue,
} from './retry';
import type { QueuedAutomationJob } from './submit';

const caller: AutomationCaller = {
  tokenId: 7,
  name: 'cron',
  callerType: 'cron',
  tokenPrefix: 'wa_cron',
  scopes: ['score:run'],
};

const weeklyPublishCaller: AutomationCaller = {
  ...caller,
  scopes: ['weekly:publish'],
};

const queuedJob: QueuedAutomationJob = {
  jobId: 'auto_retry',
  runId: 'auto_retry',
  status: 'queued',
  workflow: 'score',
  step: 'run',
  target: {
    targetType: 'inbox',
    targetId: 'score_batch',
    targetKey: 'inbox:score_batch',
  },
  statusUrl: '/api/v1/jobs/auto_retry',
  idempotentReplay: false,
  caller: {
    type: 'cron',
    tokenPrefix: 'wa_cron',
  },
};

function buildAutomationRuns(run: AutomationRunRetryRow | null) {
  return {
    findUnique: vi.fn(async () => run),
  };
}

function buildQueue(data: unknown): RetryQueue {
  return {
    getJob: vi.fn(async () => data === null ? null : { data }),
    add: vi.fn(async () => ({ id: 'auto_retry' })),
  };
}

describe('retryAutomationRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a new queued run from the retained original payload', async () => {
    const automationRuns = buildAutomationRuns({
      id: 'auto_1',
      workflow: 'score',
      step: 'run',
      status: 'failed',
    });
    const queue = buildQueue({
      runId: 'auto_1',
      payload: { limit: 50, delay: 0 },
    });
    const submitJob = vi.fn(async () => queuedJob);

    await expect(retryAutomationRun({
      runId: 'auto_1',
      caller,
      idempotencyKey: 'retry-click-1',
    }, {
      automationRuns,
      queue,
      submitJob,
      prefix: 'weekly-test',
    })).resolves.toEqual({
      ...queuedJob,
      retryOfRunId: 'auto_1',
    });

    expect(submitJob).toHaveBeenCalledWith({
      caller,
      jobName: 'score.run',
      idempotencyKey: buildRetryIdempotencyKey('auto_1', 'retry-click-1'),
      payload: { limit: 50, delay: 0 },
    }, {
      queue,
      redis: undefined,
      prefix: 'weekly-test',
    });
  });

  it('rejects non-failed runs', async () => {
    await expect(retryAutomationRun({
      runId: 'auto_1',
      caller,
      idempotencyKey: 'retry-click-1',
    }, {
      automationRuns: buildAutomationRuns({
        id: 'auto_1',
        workflow: 'score',
        step: 'run',
        status: 'running',
      }),
      queue: buildQueue({ payload: { limit: 50 } }),
    })).rejects.toMatchObject({
      code: 'JOB_NOT_RETRYABLE',
      status: 409,
    } satisfies Partial<JobRetryError>);
  });

  it('rejects retry when the retained BullMQ payload expired', async () => {
    await expect(retryAutomationRun({
      runId: 'auto_1',
      caller,
      idempotencyKey: 'retry-click-1',
    }, {
      automationRuns: buildAutomationRuns({
        id: 'auto_1',
        workflow: 'score',
        step: 'run',
        status: 'failed',
      }),
      queue: buildQueue(null),
    })).rejects.toMatchObject({
      code: 'RETRY_PAYLOAD_UNAVAILABLE',
      status: 409,
    } satisfies Partial<JobRetryError>);
  });

  it('requires the original workflow write scope', async () => {
    await expect(retryAutomationRun({
      runId: 'auto_1',
      caller: {
        ...caller,
        scopes: ['sync:run'],
      },
      idempotencyKey: 'retry-click-1',
    }, {
      automationRuns: buildAutomationRuns({
        id: 'auto_1',
        workflow: 'score',
        step: 'run',
        status: 'failed',
      }),
      queue: buildQueue({ payload: { limit: 50 } }),
    })).rejects.toMatchObject({
      code: 'AUTOMATION_SCOPE_FORBIDDEN',
      status: 403,
    });
  });

  it('creates a new queued weekly publish run from the retained original payload', async () => {
    const automationRuns = buildAutomationRuns({
      id: 'auto_1',
      workflow: 'weekly',
      step: 'publish',
      status: 'failed',
    });
    const queue = buildQueue({
      runId: 'auto_1',
      payload: { weeklyIssueId: 7, deliver: true },
    });
    const weeklyQueuedJob: QueuedAutomationJob = {
      ...queuedJob,
      workflow: 'weekly',
      step: 'publish',
      target: {
        targetType: 'weekly_issue',
        targetId: '7',
        targetKey: 'weekly_issue:7',
      },
    };
    const submitJob = vi.fn(async () => weeklyQueuedJob);

    await expect(retryAutomationRun({
      runId: 'auto_1',
      caller: weeklyPublishCaller,
      idempotencyKey: 'retry-click-1',
    }, {
      automationRuns,
      queue,
      submitJob,
    })).resolves.toEqual({
      ...weeklyQueuedJob,
      retryOfRunId: 'auto_1',
    });

    expect(submitJob).toHaveBeenCalledWith({
      caller: weeklyPublishCaller,
      jobName: 'weekly.publish',
      idempotencyKey: buildRetryIdempotencyKey('auto_1', 'retry-click-1'),
      payload: { weeklyIssueId: 7, deliver: true },
    }, {
      queue,
      redis: undefined,
      prefix: undefined,
    });
  });

  it('rejects unsupported reserved workflow retries', async () => {
    await expect(retryAutomationRun({
      runId: 'auto_1',
      caller: weeklyPublishCaller,
      idempotencyKey: 'retry-click-1',
    }, {
      automationRuns: buildAutomationRuns({
        id: 'auto_1',
        workflow: 'weekly',
        step: 'suggest',
        status: 'failed',
      }),
      queue: buildQueue({ payload: { weeklyIssueId: 1 } }),
    })).rejects.toMatchObject({
      code: 'JOB_RETRY_UNSUPPORTED',
      status: 409,
    } satisfies Partial<JobRetryError>);
  });
});
