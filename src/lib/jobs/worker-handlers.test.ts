import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getDataSourceByIdMock = vi.fn();
const listDataSourcesMock = vi.fn();
const syncDataSourceMock = vi.fn();
const runBatchMock = vi.fn();
const executeKarakeepResyncJobMock = vi.fn();
const findWeeklyIssueMock = vi.fn();
const publishWeeklyMock = vi.fn();
const organizeWeeklyMock = vi.fn();
const validateWeeklySuggestionItemsMock = vi.fn();
const applyWeeklySuggestionMock = vi.fn();

vi.mock('@/lib/services/data-source', () => ({
  DataSourceService: {
    getDataSourceById: (...args: unknown[]) => getDataSourceByIdMock(...args),
    listDataSources: (...args: unknown[]) => listDataSourcesMock(...args),
  },
}));

vi.mock('@/lib/services/sync-orchestrator', () => ({
  SyncOrchestrator: {
    syncDataSource: (...args: unknown[]) => syncDataSourceMock(...args),
  },
}));

vi.mock('@/lib/services/inbox-scoring', () => ({
  InboxScoringService: {
    runBatch: (...args: unknown[]) => runBatchMock(...args),
  },
}));

vi.mock('@/lib/services/karakeep-resync', () => ({
  executeKarakeepResyncJob: (...args: unknown[]) => executeKarakeepResyncJobMock(...args),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    weekly_issues: {
      findUnique: (...args: unknown[]) => findWeeklyIssueMock(...args),
    },
  },
}));

vi.mock('@/lib/services/quail', () => ({
  quailService: {
    publishWeekly: (...args: unknown[]) => publishWeeklyMock(...args),
  },
}));

vi.mock('@/lib/ai/server/weekly-organizer', () => ({
  organizeWeekly: (...args: unknown[]) => organizeWeeklyMock(...args),
}));

vi.mock('@/lib/automation/weekly-suggestions', async () => {
  const actual = await vi.importActual<typeof import('@/lib/automation/weekly-suggestions')>('@/lib/automation/weekly-suggestions');
  return {
    ...actual,
    validateWeeklySuggestionItems: (...args: unknown[]) => validateWeeklySuggestionItemsMock(...args),
    applyWeeklySuggestion: (...args: unknown[]) => applyWeeklySuggestionMock(...args),
  };
});

import { AutomationJobExecutionError, executeAutomationJob } from './worker-handlers';

describe('automation worker handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('executes a source-specific sync job', async () => {
    getDataSourceByIdMock.mockResolvedValueOnce({
      id: 7,
      name: 'Karakeep',
      sync_interval_minutes: null,
      last_synced_at: null,
    });
    syncDataSourceMock.mockResolvedValueOnce({ upserted: 2, errors: [] });

    await expect(executeAutomationJob('sync.run', { sourceId: 7, max_items: 10 })).resolves.toMatchObject({
      status: 'succeeded',
      result: {
        status: 'succeeded',
        total_sources: 1,
        ok_count: 1,
        failed_count: 0,
      },
    });
    expect(syncDataSourceMock).toHaveBeenCalledWith(7, expect.objectContaining({ max_items: 10 }));
  });

  it('returns partial success for mixed sync failures and skips not-due sources', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-08T00:00:00.000Z'));
    listDataSourcesMock.mockResolvedValueOnce([
      { id: 1, name: 'Due', sync_interval_minutes: 60, last_synced_at: new Date('2026-06-07T22:00:00.000Z') },
      { id: 2, name: 'Not due', sync_interval_minutes: 60, last_synced_at: new Date('2026-06-07T23:30:00.000Z') },
      { id: 3, name: 'Failed', sync_interval_minutes: 60, last_synced_at: null },
    ]);
    syncDataSourceMock
      .mockResolvedValueOnce({ upserted: 1 })
      .mockRejectedValueOnce(new Error('source failed'));

    await expect(executeAutomationJob('sync.run', { only_due: true })).resolves.toMatchObject({
      status: 'partial_success',
      result: {
        total_sources: 2,
        ok_count: 1,
        failed_count: 1,
      },
    });
    expect(syncDataSourceMock).toHaveBeenCalledTimes(2);
  });

  it('returns empty when no sync sources are selected', async () => {
    listDataSourcesMock.mockResolvedValueOnce([]);

    await expect(executeAutomationJob('sync.run', {})).resolves.toMatchObject({
      status: 'empty',
      result: {
        status: 'empty',
        total_sources: 0,
        ok_count: 0,
        failed_count: 0,
      },
    });
    expect(syncDataSourceMock).not.toHaveBeenCalled();
  });

  it('throws an execution error when every sync source fails', async () => {
    listDataSourcesMock.mockResolvedValueOnce([
      { id: 1, name: 'Failed A', sync_interval_minutes: null, last_synced_at: null },
      { id: 2, name: 'Failed B', sync_interval_minutes: null, last_synced_at: null },
    ]);
    syncDataSourceMock
      .mockRejectedValueOnce(new Error('source failed a'))
      .mockRejectedValueOnce(new Error('source failed b'));

    const error = await executeAutomationJob('sync.run', {}).catch((value) => value);

    expect(error).toBeInstanceOf(AutomationJobExecutionError);
    expect(error.summary).toMatchObject({
      status: 'failed',
      total_sources: 2,
      ok_count: 0,
      failed_count: 2,
    });
  });

  it('executes scoring batch and maps empty/partial statuses', async () => {
    runBatchMock.mockResolvedValueOnce({ scored: 0, failed: 0, skipped: 0, errors: [] });
    await expect(executeAutomationJob('score.run', {})).resolves.toMatchObject({
      status: 'empty',
      result: { status: 'empty' },
    });

    runBatchMock.mockResolvedValueOnce({ scored: 2, failed: 1, skipped: 0, errors: ['boom'] });
    await expect(executeAutomationJob('score.run', { limit: 2, delay: 0 })).resolves.toMatchObject({
      status: 'partial_success',
      result: { status: 'partial_success', scored: 2, failed: 1 },
    });
    expect(runBatchMock).toHaveBeenLastCalledWith({ limit: 2, delayMs: 0, source: 'api' });
  });

  it('throws an execution error when scoring batch has only failures', async () => {
    runBatchMock.mockResolvedValueOnce({ scored: 0, failed: 1, skipped: 0, errors: ['boom'] });

    const error = await executeAutomationJob('score.run', { limit: 1 }).catch((value) => value);

    expect(error).toBeInstanceOf(AutomationJobExecutionError);
    expect(error.summary).toMatchObject({
      status: 'failed',
      scored: 0,
      failed: 1,
      errors: ['boom'],
    });
  });

  it('executes Karakeep resync through the worker handler', async () => {
    executeKarakeepResyncJobMock.mockResolvedValueOnce({
      status: 'succeeded',
      result: {
        status: 'succeeded',
        contentId: 42,
        karakeepId: 'bookmark_1',
      },
      externalSideEffect: true,
      externalRef: 'bookmark_1',
    });

    await expect(executeAutomationJob('karakeep.resync', {
      contentId: 42,
      karakeepId: 'bookmark_1',
      sourceUrl: 'https://example.com/post',
      refreshScreenshot: false,
      screenshotLocked: true,
      maxAttempts: 12,
    })).resolves.toMatchObject({
      status: 'succeeded',
      result: {
        contentId: 42,
        karakeepId: 'bookmark_1',
      },
      externalSideEffect: true,
    });
    expect(executeKarakeepResyncJobMock).toHaveBeenCalledWith(expect.objectContaining({
      contentId: 42,
      karakeepId: 'bookmark_1',
    }));
  });

  it('generates weekly suggestions through the worker handler', async () => {
    organizeWeeklyMock.mockResolvedValueOnce({
      intro: '建议聚焦 AI 工具',
      items: [{ content_id: 10, section: 'AI', reason: '高分候选' }],
    });

    await expect(executeAutomationJob('weekly.suggest', {
      weeklyIssueId: 7,
      maxItems: 5,
    })).resolves.toMatchObject({
      status: 'succeeded',
      result: {
        status: 'preview',
        weeklyIssueId: 7,
        provider: 'admin',
        suggestion: {
          items: [{ content_id: 10, section: 'AI', featured: false, reason: '高分候选' }],
        },
      },
    });
    expect(organizeWeeklyMock).toHaveBeenCalledWith({ weeklyIssueId: 7, maxItems: 5 });
  });

  it('registers Hermes weekly suggestion artifacts through the worker handler', async () => {
    validateWeeklySuggestionItemsMock.mockResolvedValueOnce({ issue: {}, contents: [] });

    await expect(executeAutomationJob('weekly.suggest', {
      mode: 'register',
      artifact: {
        provider: 'hermes',
        weeklyIssueId: 7,
        agentRunId: 'hermes_1',
        confidence: 0.8,
        items: [{ content_id: 10, section: 'AI', reason: '偏好命中' }],
      },
    })).resolves.toMatchObject({
      status: 'succeeded',
      result: {
        status: 'preview',
        provider: 'hermes',
        weeklyIssueId: 7,
        agentRunId: 'hermes_1',
        confidence: 0.8,
      },
    });
    expect(validateWeeklySuggestionItemsMock).toHaveBeenCalledWith({
      weeklyIssueId: 7,
      items: [expect.objectContaining({ content_id: 10, section: 'AI' })],
    });
  });

  it('applies weekly suggestions through the worker handler', async () => {
    applyWeeklySuggestionMock.mockResolvedValueOnce({
      status: 'applied',
      weeklyIssueId: 7,
      linkedCount: 1,
      skippedCount: 0,
      linkedContents: [{ id: 10, title: 'A', section: 'AI' }],
      skippedContents: [],
    });

    await expect(executeAutomationJob('weekly.apply', {
      weeklyIssueId: 7,
      items: [{ content_id: 10, section: 'AI' }],
    })).resolves.toMatchObject({
      status: 'succeeded',
      result: {
        status: 'applied',
        weeklyIssueId: 7,
        linkedCount: 1,
      },
    });
    expect(applyWeeklySuggestionMock).toHaveBeenCalledWith({
      weeklyIssueId: 7,
      replaceExisting: false,
      sourceRunId: undefined,
      agentRunId: undefined,
      items: [{ content_id: 10, section: 'AI', featured: false }],
    });
  });

  it('publishes a weekly issue through Quail', async () => {
    findWeeklyIssueMock.mockResolvedValueOnce({
      id: 7,
      issue_number: 7,
      title: '第 7 期',
      status: 'draft',
      quail_post_id: null,
      quail_post_slug: null,
      quail_published_at: null,
      quail_delivered_at: null,
    });
    publishWeeklyMock.mockResolvedValueOnce({
      success: true,
      quailPostId: 'qp_1',
      quailPostSlug: 'weekly-7',
    });

    await expect(executeAutomationJob('weekly.publish', {
      weeklyIssueId: 7,
      deliver: true,
    })).resolves.toMatchObject({
      status: 'succeeded',
      result: {
        status: 'published',
        weeklyIssueId: 7,
        issueNumber: 7,
        deliverRequested: true,
        forceRepublish: false,
        quailPostId: 'qp_1',
        quailPostSlug: 'weekly-7',
      },
      externalSideEffect: true,
      externalRef: 'weekly-7',
    });
    expect(findWeeklyIssueMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 7 },
    }));
    expect(publishWeeklyMock).toHaveBeenCalledWith(7, {
      forceRepublish: false,
      deliver: true,
    });
  });

  it('fails weekly publish when the issue was already published', async () => {
    findWeeklyIssueMock.mockResolvedValueOnce({
      id: 7,
      issue_number: 7,
      title: '第 7 期',
      status: 'published',
      quail_post_id: 'qp_1',
      quail_post_slug: 'weekly-7',
      quail_published_at: new Date('2026-06-01T00:00:00.000Z'),
      quail_delivered_at: null,
    });

    const error = await executeAutomationJob('weekly.publish', { weeklyIssueId: 7 }).catch((value) => value);

    expect(error).toBeInstanceOf(AutomationJobExecutionError);
    expect(error.summary).toMatchObject({
      status: 'failed',
      code: 'WEEKLY_ALREADY_PUBLISHED',
      weeklyIssueId: 7,
      quailPostSlug: 'weekly-7',
    });
    expect(publishWeeklyMock).not.toHaveBeenCalled();
  });

  it('fails weekly publish when Quail rejects the publish', async () => {
    findWeeklyIssueMock.mockResolvedValueOnce({
      id: 7,
      issue_number: 7,
      title: '第 7 期',
      status: 'draft',
      quail_post_id: null,
      quail_post_slug: null,
      quail_published_at: null,
      quail_delivered_at: null,
    });
    publishWeeklyMock.mockResolvedValueOnce({ success: false, error: 'Quail down' });

    const error = await executeAutomationJob('weekly.publish', {
      weeklyIssueId: 7,
      forceRepublish: true,
    }).catch((value) => value);

    expect(error).toBeInstanceOf(AutomationJobExecutionError);
    expect(error.message).toBe('Quail down');
    expect(error.summary).toMatchObject({
      status: 'failed',
      code: 'PUBLISH_FAILED',
      weeklyIssueId: 7,
      forceRepublish: true,
    });
  });
});
