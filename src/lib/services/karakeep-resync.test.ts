// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const contentsFindUniqueMock = vi.fn();
const contentsUpdateMock = vi.fn();
const attributeUpsertMock = vi.fn();
const updateBookmarkMock = vi.fn();
const getBookmarkMock = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: {
    contents: {
      findUnique: (...args: unknown[]) => contentsFindUniqueMock(...args),
      update: (...args: unknown[]) => contentsUpdateMock(...args),
    },
    content_attributes: {
      upsert: (...args: unknown[]) => attributeUpsertMock(...args),
    },
  },
}));

vi.mock('@/lib/services/karakeep-api', () => ({
  getKarakeepApi: () => ({
    updateBookmark: (...args: unknown[]) => updateBookmarkMock(...args),
    getBookmark: (...args: unknown[]) => getBookmarkMock(...args),
  }),
}));

import {
  executeKarakeepResyncJob,
  mapKarakeepResyncStatus,
  type KarakeepResyncPayload,
} from './karakeep-resync';
import type { AutomationJobStatus } from '@/lib/jobs/status';

const payload: KarakeepResyncPayload = {
  contentId: 42,
  karakeepId: 'bookmark_1',
  sourceUrl: 'https://example.com/post',
  refreshScreenshot: false,
  screenshotLocked: true,
  maxAttempts: 3,
};

function buildStatus(overrides: Partial<AutomationJobStatus> = {}): AutomationJobStatus {
  return {
    runId: 'auto_1',
    status: 'running',
    durableStatus: 'running',
    historyOnly: false,
    workflow: 'content',
    step: 'karakeep_resync',
    targetType: 'content',
    targetId: '42',
    startedAt: '2026-06-22T00:00:00.000Z',
    finishedAt: null,
    resultSummary: null,
    errorCode: null,
    errorMessage: null,
    redis: { available: true, statusExpired: false },
    queue: { available: true, state: 'active', attemptsMade: 1, attempts: 2 },
    ...overrides,
  };
}

describe('karakeep resync service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates Karakeep, waits for summary, and applies content summary', async () => {
    contentsFindUniqueMock.mockResolvedValueOnce({ id: BigInt(42) });
    updateBookmarkMock.mockResolvedValueOnce(undefined);
    getBookmarkMock.mockResolvedValueOnce({
      summary: 'Fresh summary',
      summarizationStatus: 'success',
      taggingStatus: 'success',
    });
    contentsUpdateMock.mockResolvedValueOnce({});
    attributeUpsertMock.mockResolvedValue({});

    const result = await executeKarakeepResyncJob(payload, {
      now: () => new Date('2026-06-22T12:00:00.000Z'),
      sleep: async () => undefined,
    });

    expect(updateBookmarkMock).toHaveBeenCalledWith('bookmark_1', {
      url: 'https://example.com/post',
      archived: false,
    });
    expect(contentsUpdateMock).toHaveBeenCalledWith({
      where: { id: BigInt(42) },
      data: { summary: 'Fresh summary' },
    });
    expect(attributeUpsertMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      status: 'succeeded',
      externalSideEffect: true,
      externalRef: 'bookmark_1',
      result: {
        contentId: 42,
        karakeepId: 'bookmark_1',
        appliedSummary: 'Fresh summary',
        attempts: 1,
      },
    });
  });

  it('fails when Karakeep never completes within max attempts', async () => {
    contentsFindUniqueMock.mockResolvedValueOnce({ id: BigInt(42) });
    updateBookmarkMock.mockResolvedValueOnce(undefined);
    getBookmarkMock.mockResolvedValue({
      summarizationStatus: 'pending',
      taggingStatus: 'pending',
    });

    await expect(executeKarakeepResyncJob(payload, {
      sleep: async () => undefined,
    })).rejects.toThrow('轮询超时');
  });

  it('maps automation status to legacy resync response shape', () => {
    const mapped = mapKarakeepResyncStatus(buildStatus(), payload);

    expect(mapped).toMatchObject({
      jobId: 'auto_1',
      runId: 'auto_1',
      contentId: 42,
      karakeepId: 'bookmark_1',
      phase: 'waiting',
      attempt: 1,
      maxAttempts: 3,
      refreshScreenshot: false,
      screenshotLocked: true,
    });
  });

  it('maps failed durable status to failed phase and message', () => {
    const mapped = mapKarakeepResyncStatus(buildStatus({
      status: 'failed',
      durableStatus: 'failed',
      errorMessage: 'boom',
      finishedAt: '2026-06-22T12:00:00.000Z',
    }), payload);

    expect(mapped.phase).toBe('failed');
    expect(mapped.message).toBe('boom');
  });
});
