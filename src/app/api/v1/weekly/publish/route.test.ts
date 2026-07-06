// @vitest-environment node
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runQueuedAutomationRouteMock = vi.fn();

vi.mock('@/lib/automation/http', async () => {
  const actual = await vi.importActual<typeof import('@/lib/automation/http')>('@/lib/automation/http');
  return {
    ...actual,
    runQueuedAutomationRoute: (...args: unknown[]) => runQueuedAutomationRouteMock(...args),
  };
});

import { POST } from './route';

describe('/api/v1/weekly/publish', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runQueuedAutomationRouteMock.mockResolvedValue(Response.json({
      success: true,
      data: {
        status: 'queued',
        jobId: 'auto_1',
        runId: 'auto_1',
        workflow: 'weekly',
        step: 'publish',
        target: {
          targetType: 'weekly_issue',
          targetId: '7',
          targetKey: 'weekly_issue:7',
        },
        statusUrl: '/api/v1/jobs/auto_1',
        idempotentReplay: false,
      },
      meta: { runId: 'auto_1', status: 'queued' },
    }, { status: 202 }));
  });

  it('requires an idempotency key', async () => {
    const response = await POST(new NextRequest('http://localhost/api/v1/weekly/publish', {
      method: 'POST',
      body: JSON.stringify({ weeklyIssueId: 7 }),
    }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('IDEMPOTENCY_PAYLOAD_CONFLICT');
  });

  it('queues weekly publish through the automation job wrapper', async () => {
    const response = await POST(new NextRequest('http://localhost/api/v1/weekly/publish', {
      method: 'POST',
      headers: { 'idempotency-key': 'publish-7' },
      body: JSON.stringify({ weeklyIssueId: 7, deliver: true }),
    }));
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(runQueuedAutomationRouteMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      scope: 'weekly:publish',
      jobName: 'weekly.publish',
      idempotencyKey: 'publish-7',
      requestPayload: {
        weeklyIssueId: 7,
        forceRepublish: false,
        deliver: true,
      },
    });
    expect(body.data.status).toBe('queued');
    expect(body.data.statusUrl).toBe('/api/v1/jobs/auto_1');
  });
});
