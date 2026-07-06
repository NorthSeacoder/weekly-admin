// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const authenticateRequestMock = vi.fn();
const authenticateAutomationTokenValueMock = vi.fn();
const submitAutomationJobMock = vi.fn();
const getContentByIdMock = vi.fn();
const getKarakeepResyncStatusMock = vi.fn();

vi.mock('@/lib/auth', () => ({
  authenticateRequest: (...args: unknown[]) => authenticateRequestMock(...args),
}));

vi.mock('@/lib/automation/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/automation/auth')>('@/lib/automation/auth');
  return {
    ...actual,
    authenticateAutomationTokenValue: (...args: unknown[]) => authenticateAutomationTokenValueMock(...args),
  };
});

vi.mock('@/lib/jobs/submit', () => ({
  submitAutomationJob: (...args: unknown[]) => submitAutomationJobMock(...args),
}));

vi.mock('@/lib/services/content', () => ({
  ContentService: {
    getContentById: (...args: unknown[]) => getContentByIdMock(...args),
  },
}));

vi.mock('@/lib/services/karakeep-resync', async () => {
  const actual = await vi.importActual<typeof import('@/lib/services/karakeep-resync')>('@/lib/services/karakeep-resync');
  return {
    ...actual,
    getKarakeepResyncStatus: (...args: unknown[]) => getKarakeepResyncStatusMock(...args),
  };
});

import { GET, POST } from './route';

function params(id = '42') {
  return { params: Promise.resolve({ id }) };
}

function buildContent() {
  return {
    id: 42,
    source_url: 'https://example.com/post',
    screenshot_api: 'manual',
    attributes: [
      { attribute_name: 'karakeep_id', attribute_value: 'bookmark_1' },
    ],
  };
}

describe('/api/content/[id]/karakeep-resync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    authenticateRequestMock.mockResolvedValue({ success: true, user: { id: 1, username: 'admin' } });
  });

  it('queues a Karakeep resync job and returns the legacy job shape', async () => {
    vi.stubEnv('ADMIN_UI_AUTOMATION_TOKEN', 'wa_internal');
    getContentByIdMock.mockResolvedValueOnce(buildContent());
    authenticateAutomationTokenValueMock.mockResolvedValueOnce({
      tokenId: 9,
      callerType: 'admin-ui',
      tokenPrefix: 'wa_internal',
      scopes: ['content:resync'],
      name: 'Admin UI',
    });
    submitAutomationJobMock.mockResolvedValueOnce({
      runId: 'auto_1',
      jobId: 'auto_1',
      status: 'queued',
      statusUrl: '/api/v1/jobs/auto_1',
      idempotentReplay: false,
      caller: { type: 'admin-ui', tokenPrefix: 'wa_internal' },
      workflow: 'content',
      step: 'karakeep_resync',
      target: { targetType: 'content', targetId: '42', targetKey: 'content:42' },
    });

    const response = await POST(new NextRequest('http://localhost/api/content/42/karakeep-resync', {
      method: 'POST',
      body: JSON.stringify({ refreshScreenshot: true, maxAttempts: 20 }),
    }), params());
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(authenticateAutomationTokenValueMock).toHaveBeenCalledWith('wa_internal', 'content:resync');
    expect(submitAutomationJobMock).toHaveBeenCalledWith(expect.objectContaining({
      jobName: 'karakeep.resync',
      payload: expect.objectContaining({
        contentId: 42,
        karakeepId: 'bookmark_1',
        sourceUrl: 'https://example.com/post',
        refreshScreenshot: false,
        screenshotLocked: true,
        maxAttempts: 20,
      }),
    }));
    expect(body.data).toMatchObject({
      jobId: 'auto_1',
      runId: 'auto_1',
      contentId: 42,
      karakeepId: 'bookmark_1',
      phase: 'updating',
      maxAttempts: 20,
      statusUrl: '/api/v1/jobs/auto_1',
    });
  });

  it('fails clearly when the internal automation token is missing', async () => {
    getContentByIdMock.mockResolvedValueOnce(buildContent());

    const response = await POST(new NextRequest('http://localhost/api/content/42/karakeep-resync', {
      method: 'POST',
      body: JSON.stringify({}),
    }), params());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toBe('ADMIN_UI_AUTOMATION_TOKEN_MISSING');
    expect(submitAutomationJobMock).not.toHaveBeenCalled();
  });

  it('reads queued job status without progressing the worker', async () => {
    getKarakeepResyncStatusMock.mockResolvedValueOnce({
      jobId: 'auto_1',
      runId: 'auto_1',
      contentId: 42,
      karakeepId: 'bookmark_1',
      phase: 'waiting',
      attempt: 1,
      maxAttempts: 12,
      refreshScreenshot: false,
      screenshotLocked: true,
      updatedAt: '2026-06-22T00:00:00.000Z',
    });

    const response = await GET(new NextRequest('http://localhost/api/content/42/karakeep-resync?jobId=auto_1'), params());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getKarakeepResyncStatusMock).toHaveBeenCalledWith('auto_1');
    expect(body.data.phase).toBe('waiting');
  });

  it('rejects status for a different content target', async () => {
    getKarakeepResyncStatusMock.mockResolvedValueOnce({
      jobId: 'auto_1',
      contentId: 99,
      karakeepId: 'bookmark_1',
      phase: 'waiting',
      attempt: 1,
      maxAttempts: 12,
      refreshScreenshot: false,
      screenshotLocked: true,
      updatedAt: '2026-06-22T00:00:00.000Z',
    });

    const response = await GET(new NextRequest('http://localhost/api/content/42/karakeep-resync?jobId=auto_1'), params());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('JOB_MISMATCH');
  });
});
