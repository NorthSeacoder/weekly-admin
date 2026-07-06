import { Queue, type QueueOptions } from 'bullmq';

import type { AutomationRunSuccess } from '@/lib/automation/run';
import { prisma } from '@/lib/db';
import {
  getAutomationJobStatus,
  type AutomationJobStatus,
  type JobStatusQueue,
} from '@/lib/jobs/status';
import { getJobQueuePrefix, getJobRedisConnection } from '@/lib/jobs/connection';
import { getKarakeepApi } from '@/lib/services/karakeep-api';
import type { KarakeepBookmark } from './karakeep-api';

export type ResyncPhase = 'updating' | 'waiting' | 'applying' | 'success' | 'failed';

export interface KarakeepResyncJob {
  jobId: string;
  runId?: string;
  contentId: number;
  karakeepId: string;
  phase: ResyncPhase;
  attempt: number;
  maxAttempts: number;
  refreshScreenshot: boolean;
  screenshotLocked: boolean;
  message?: string;
  summarizationStatus?: string;
  taggingStatus?: string;
  appliedSummary?: string | null;
  appliedImage?: string | null;
  updatedAt: string;
  statusUrl?: string;
  historyOnly?: boolean;
}

export type KarakeepResyncPayload = {
  contentId: number;
  karakeepId: string;
  sourceUrl: string;
  refreshScreenshot: boolean;
  screenshotLocked: boolean;
  maxAttempts: number;
  pollIntervalMs?: number;
};

export type KarakeepResyncResultSummary = {
  status: 'succeeded';
  contentId: number;
  karakeepId: string;
  appliedSummary: string | null;
  appliedImage: null;
  summarizationStatus?: string;
  taggingStatus?: string;
  attempts: number;
  maxAttempts: number;
  karakeepSyncedAt: string;
};

type KarakeepResyncDeps = {
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

type QueueJobWithData = {
  data?: unknown;
};

const DEFAULT_POLL_INTERVAL_MS = 3000;

const nowIso = (now: () => Date = () => new Date()) => now().toISOString();

export async function executeKarakeepResyncJob(
  payload: KarakeepResyncPayload,
  deps: KarakeepResyncDeps = {}
): Promise<AutomationRunSuccess<KarakeepResyncResultSummary>> {
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const api = getKarakeepApi('重跑任务');
  if (!api) {
    throw new Error('Karakeep 未配置，无法执行重跑任务');
  }

  const content = await prisma.contents.findUnique({
    where: { id: BigInt(payload.contentId) },
    select: { id: true },
  });
  if (!content) {
    throw new Error('内容不存在，无法写回 Karakeep 重跑结果');
  }

  await api.updateBookmark(payload.karakeepId, {
    url: payload.sourceUrl,
    archived: false,
  });

  let lastBookmark: KarakeepBookmark | null = null;
  const maxAttempts = normalizeMaxAttempts(payload.maxAttempts);
  const pollIntervalMs = payload.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const bookmark = await api.getBookmark(payload.karakeepId);
    lastBookmark = bookmark;

    const summarizationDone = bookmark.summarizationStatus === 'success';
    const taggingDone = !bookmark.taggingStatus || bookmark.taggingStatus === 'success';
    if (summarizationDone && taggingDone) {
      const applied = await applyBookmarkToContent(payload, bookmark, now);
      return {
        status: 'succeeded',
        result: {
          status: 'succeeded',
          contentId: payload.contentId,
          karakeepId: payload.karakeepId,
          appliedSummary: applied.summary,
          appliedImage: null,
          summarizationStatus: bookmark.summarizationStatus,
          taggingStatus: bookmark.taggingStatus,
          attempts: attempt,
          maxAttempts,
          karakeepSyncedAt: applied.syncedAt,
        },
        externalSideEffect: true,
        externalRef: payload.karakeepId,
      };
    }

    if (attempt < maxAttempts) {
      await sleep(pollIntervalMs);
    }
  }

  throw new Error(
    `轮询超时，Karakeep 仍未完成 summary/tagging（summary=${lastBookmark?.summarizationStatus ?? 'unknown'}, tagging=${lastBookmark?.taggingStatus ?? 'unknown'}）`
  );
}

export async function getKarakeepResyncStatus(jobId: string): Promise<KarakeepResyncJob | null> {
  const status = await getAutomationJobStatus(jobId);
  if (!status) return null;
  const payload = await readKarakeepResyncPayload(jobId);
  return mapKarakeepResyncStatus(status, payload);
}

export function mapKarakeepResyncStatus(
  status: AutomationJobStatus,
  payload?: Partial<KarakeepResyncPayload> | null
): KarakeepResyncJob {
  const result = parseResultSummary(status.resultSummary);
  const contentId = numberFromUnknown(payload?.contentId) ?? numberFromUnknown(status.targetId) ?? result?.contentId ?? 0;
  const maxAttempts = numberFromUnknown(payload?.maxAttempts) ?? result?.maxAttempts ?? status.queue.attempts ?? 0;
  const attempt = result?.attempts ?? status.queue.attemptsMade ?? status.redis.snapshot?.attemptsMade ?? 0;
  const phase = mapStatusToPhase(status);
  const message = phase === 'failed'
    ? status.errorMessage ?? status.redis.snapshot?.error ?? 'Karakeep 重跑失败'
    : undefined;

  return {
    jobId: status.runId,
    runId: status.runId,
    contentId,
    karakeepId: String(payload?.karakeepId ?? result?.karakeepId ?? ''),
    phase,
    attempt,
    maxAttempts,
    refreshScreenshot: Boolean(payload?.refreshScreenshot),
    screenshotLocked: Boolean(payload?.screenshotLocked),
    message,
    summarizationStatus: result?.summarizationStatus,
    taggingStatus: result?.taggingStatus,
    appliedSummary: result?.appliedSummary,
    appliedImage: null,
    updatedAt: status.finishedAt ?? status.redis.snapshot?.updatedAt ?? status.startedAt ?? nowIso(),
    statusUrl: `/api/v1/jobs/${status.runId}`,
    historyOnly: status.historyOnly,
  };
}

export async function readKarakeepResyncPayload(
  jobId: string,
  queue?: JobStatusQueue
): Promise<Partial<KarakeepResyncPayload> | null> {
  let createdQueue: JobStatusQueue | null = null;
  try {
    const statusQueue = queue ?? createKarakeepPayloadQueue();
    if (!queue) createdQueue = statusQueue;
    const job = await statusQueue.getJob(jobId) as (QueueJobWithData | null);
    const data = job?.data;
    if (!data || typeof data !== 'object') return null;
    const payload = (data as { payload?: unknown }).payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    return payload as Partial<KarakeepResyncPayload>;
  } catch {
    return null;
  } finally {
    await createdQueue?.close?.().catch(() => undefined);
  }
}

function createKarakeepPayloadQueue(): JobStatusQueue {
  return new Queue('automation', {
    connection: getJobRedisConnection() as unknown as QueueOptions['connection'],
    prefix: getJobQueuePrefix(),
  }) as unknown as JobStatusQueue;
}

async function applyBookmarkToContent(
  payload: KarakeepResyncPayload,
  bookmark: KarakeepBookmark,
  now: () => Date
): Promise<{ summary: string | null; syncedAt: string }> {
  const summary = bookmark.summary || bookmark.content?.description || null;

  await prisma.contents.update({
    where: { id: BigInt(payload.contentId) },
    data: { summary },
  });

  const syncValue = nowIso(now);
  await prisma.content_attributes.upsert({
    where: {
      content_id_attribute_name: {
        content_id: BigInt(payload.contentId),
        attribute_name: 'karakeep_synced_at',
      },
    },
    create: {
      content_id: BigInt(payload.contentId),
      attribute_name: 'karakeep_synced_at',
      attribute_value: syncValue,
      attribute_type: 'date',
    },
    update: {
      attribute_value: syncValue,
      attribute_type: 'date',
    },
  });

  await prisma.content_attributes.upsert({
    where: {
      content_id_attribute_name: {
        content_id: BigInt(payload.contentId),
        attribute_name: 'karakeep_id',
      },
    },
    create: {
      content_id: BigInt(payload.contentId),
      attribute_name: 'karakeep_id',
      attribute_value: payload.karakeepId,
      attribute_type: 'string',
    },
    update: {
      attribute_value: payload.karakeepId,
      attribute_type: 'string',
    },
  });

  return { summary, syncedAt: syncValue };
}

function mapStatusToPhase(status: AutomationJobStatus): ResyncPhase {
  if (status.durableStatus === 'failed' || status.durableStatus === 'cancelled') return 'failed';
  if (status.durableStatus !== 'queued' && status.durableStatus !== 'running') return 'success';
  if (status.status === 'queued') return 'updating';
  if (status.status === 'retrying') return 'waiting';
  return 'waiting';
}

function parseResultSummary(value: unknown): KarakeepResyncResultSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Partial<KarakeepResyncResultSummary>;
  if (typeof record.contentId !== 'number' || typeof record.karakeepId !== 'string') return null;
  return record as KarakeepResyncResultSummary;
}

function numberFromUnknown(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalizeMaxAttempts(raw: number): number {
  if (!raw || Number.isNaN(raw)) return 12;
  return Math.min(Math.max(raw, 6), 30);
}
