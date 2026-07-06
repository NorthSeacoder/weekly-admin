// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authMiddlewareMock = vi.fn();
const postAutomationPublishMock = vi.fn();

vi.mock('@/lib/auth-middleware', () => ({
  authMiddleware: (...args: unknown[]) => authMiddlewareMock(...args),
}));

vi.mock('@/app/api/v1/weekly/publish/route', () => ({
  POST: (...args: unknown[]) => postAutomationPublishMock(...args),
}));

import { POST } from './route';

describe('/api/weekly/workbench/[id]/publish', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_UI_AUTOMATION_TOKEN;
    delete process.env.CRON_API_TOKEN;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('requires human auth', async () => {
    authMiddlewareMock.mockRejectedValueOnce(new Error('无效的认证令牌'));

    const response = await POST(
      new NextRequest('http://localhost/api/weekly/workbench/7/publish', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'publish-7' },
        body: JSON.stringify({ deliver: true }),
      }),
      { params: Promise.resolve({ id: '7' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe('AUTHENTICATION_REQUIRED');
    expect(postAutomationPublishMock).not.toHaveBeenCalled();
  });

  it('requires a server-side automation token', async () => {
    authMiddlewareMock.mockResolvedValueOnce({ id: 1, username: 'admin' });

    const response = await POST(
      new NextRequest('http://localhost/api/weekly/workbench/7/publish', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'publish-7' },
        body: JSON.stringify({ deliver: true }),
      }),
      { params: Promise.resolve({ id: '7' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toBe('ADMIN_UI_AUTOMATION_TOKEN_MISSING');
    expect(postAutomationPublishMock).not.toHaveBeenCalled();
  });

  it('requires idempotency key for external publish side effects', async () => {
    authMiddlewareMock.mockResolvedValueOnce({ id: 1, username: 'admin' });
    vi.stubEnv('ADMIN_UI_AUTOMATION_TOKEN', 'wa_publish');

    const response = await POST(
      new NextRequest('http://localhost/api/weekly/workbench/7/publish', {
        method: 'POST',
        body: JSON.stringify({ deliver: true }),
      }),
      { params: Promise.resolve({ id: '7' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(postAutomationPublishMock).not.toHaveBeenCalled();
  });

  it('delegates to automation publish route with server token and returns queued run evidence', async () => {
    authMiddlewareMock.mockResolvedValueOnce({ id: 1, username: 'admin' });
    vi.stubEnv('ADMIN_UI_AUTOMATION_TOKEN', 'wa_publish');
    postAutomationPublishMock.mockImplementationOnce(async (request: NextRequest) => {
      expect(request.headers.get('authorization')).toBe('Bearer wa_publish');
      expect(request.headers.get('idempotency-key')).toBe('publish-7');
      await expect(request.json()).resolves.toEqual({
        weeklyIssueId: 7,
        forceRepublish: false,
        deliver: true,
      });

      return Response.json({
        success: true,
        data: {
          status: 'queued',
          jobId: 'auto_1',
          runId: 'auto_1',
          statusUrl: '/api/v1/jobs/auto_1',
        },
        meta: { runId: 'auto_1', status: 'queued' },
      }, { status: 202 });
    });

    const response = await POST(
      new NextRequest('http://localhost/api/weekly/workbench/7/publish', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'publish-7' },
        body: JSON.stringify({ deliver: true }),
      }),
      { params: Promise.resolve({ id: '7' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body.data.status).toBe('queued');
    expect(body.data.statusUrl).toBe('/api/v1/jobs/auto_1');
    expect(body.meta).toMatchObject({
      runId: 'auto_1',
      status: 'queued',
      humanCaller: { userId: 1, username: 'admin' },
    });
  });

  it('propagates automation publish errors', async () => {
    authMiddlewareMock.mockResolvedValueOnce({ id: 1, username: 'admin' });
    vi.stubEnv('CRON_API_TOKEN', 'wa_cron');
    postAutomationPublishMock.mockResolvedValueOnce(Response.json({
      success: false,
      error: { code: 'PUBLISH_FAILED', message: 'Quail down' },
      meta: { runId: 'auto_failed', status: 'failed' },
    }, { status: 502 }));

    const response = await POST(
      new NextRequest('http://localhost/api/weekly/workbench/7/publish', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'publish-7' },
        body: JSON.stringify({ deliver: true }),
      }),
      { params: Promise.resolve({ id: '7' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error.code).toBe('PUBLISH_FAILED');
    expect(body.meta).toMatchObject({
      runId: 'auto_failed',
      status: 'failed',
      humanCaller: { userId: 1, username: 'admin' },
    });
  });
});
