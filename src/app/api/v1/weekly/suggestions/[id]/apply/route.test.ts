// @vitest-environment node
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runAutomationRouteMock = vi.fn();
const runQueuedAutomationRouteMock = vi.fn();

vi.mock('@/lib/automation/http', async () => {
  const actual = await vi.importActual<typeof import('@/lib/automation/http')>('@/lib/automation/http');
  return {
    ...actual,
    runAutomationRoute: (...args: unknown[]) => runAutomationRouteMock(...args),
    runQueuedAutomationRoute: (...args: unknown[]) => runQueuedAutomationRouteMock(...args),
  };
});

import { POST } from './route';

describe('/api/v1/weekly/suggestions/[id]/apply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runQueuedAutomationRouteMock.mockResolvedValue(Response.json({
      success: true,
      data: { status: 'queued', runId: 'auto_apply', jobId: 'auto_apply' },
      meta: { status: 'queued', runId: 'auto_apply' },
    }, { status: 202 }));
  });

  it('requires an idempotency key', async () => {
    const response = await POST(new NextRequest('http://localhost/api/v1/weekly/suggestions/1/apply', {
      method: 'POST',
      body: JSON.stringify({ items: [{ content_id: 10, section: 'AI' }] }),
    }), { params: Promise.resolve({ id: '1' }) });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('IDEMPOTENCY_PAYLOAD_CONFLICT');
  });

  it('queues suggestion apply through the automation job wrapper', async () => {
    const response = await POST(new NextRequest('http://localhost/api/v1/weekly/suggestions/7/apply', {
      method: 'POST',
      headers: { 'idempotency-key': 'apply-7' },
      body: JSON.stringify({ items: [{ content_id: 10, section: 'AI', featured: true }] }),
    }), { params: Promise.resolve({ id: '7' }) });
    const body = await response.json();

    expect(runQueuedAutomationRouteMock).toHaveBeenCalledWith(expect.any(NextRequest), expect.objectContaining({
      scope: 'weekly:suggest',
      jobName: 'weekly.apply',
      idempotencyKey: 'apply-7',
      requestPayload: {
        weeklyIssueId: 7,
        replaceExisting: false,
        sourceRunId: undefined,
        agentRunId: undefined,
        items: [{ content_id: 10, section: 'AI', featured: true }],
      },
    }));
    expect(runAutomationRouteMock).not.toHaveBeenCalled();
    expect(response.status).toBe(202);
    expect(body.data.status).toBe('queued');
  });

  it('keeps source run metadata on the apply request payload', async () => {
    await POST(new NextRequest('http://localhost/api/v1/weekly/suggestions/7/apply', {
      method: 'POST',
      headers: { 'idempotency-key': 'apply-7-source' },
      body: JSON.stringify({
        sourceRunId: 'auto_suggest',
        agentRunId: 'hermes_1',
        items: [{ content_id: 10, section: 'AI' }],
      }),
    }), { params: Promise.resolve({ id: '7' }) });

    expect(runQueuedAutomationRouteMock).toHaveBeenCalledWith(expect.any(NextRequest), expect.objectContaining({
      requestPayload: expect.objectContaining({
        weeklyIssueId: 7,
        sourceRunId: 'auto_suggest',
        agentRunId: 'hermes_1',
      }),
    }));
  });
});
