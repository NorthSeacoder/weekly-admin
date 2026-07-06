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

describe('/api/v1/weekly/suggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runQueuedAutomationRouteMock.mockResolvedValue(Response.json({
      success: true,
      data: { status: 'queued', runId: 'auto_suggest', jobId: 'auto_suggest' },
      meta: { status: 'queued', runId: 'auto_suggest' },
    }, { status: 202 }));
  });

  it('requires idempotency for suggestion generation', async () => {
    const response = await POST(new NextRequest('http://localhost/api/v1/weekly/suggestions', {
      method: 'POST',
      body: JSON.stringify({ weeklyIssueId: 1 }),
    }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('IDEMPOTENCY_PAYLOAD_CONFLICT');
  });

  it('queues Admin suggestion generation without applying weekly items', async () => {
    const response = await POST(new NextRequest('http://localhost/api/v1/weekly/suggestions', {
      method: 'POST',
      headers: { 'idempotency-key': 'suggest-1' },
      body: JSON.stringify({ weeklyIssueId: 1, maxItems: 5 }),
    }));
    const body = await response.json();

    expect(runQueuedAutomationRouteMock).toHaveBeenCalledWith(expect.any(NextRequest), expect.objectContaining({
      scope: 'weekly:suggest',
      jobName: 'weekly.suggest',
      idempotencyKey: 'suggest-1',
      requestPayload: { weeklyIssueId: 1, maxItems: 5 },
    }));
    expect(runAutomationRouteMock).not.toHaveBeenCalled();
    expect(response.status).toBe(202);
    expect(body.data.status).toBe('queued');
  });

  it('queues Hermes preview artifact registration without applying weekly items', async () => {
    const payload = {
      mode: 'register',
      artifact: {
        provider: 'hermes',
        weeklyIssueId: 7,
        agentRunId: 'hermes_1',
        confidence: 0.8,
        evidenceRefs: [{ label: 'feedback digest', runId: 'auto_digest' }],
        preferenceRefs: ['pref_1'],
        items: [{ content_id: 10, section: 'AI', reason: 'matches preference' }],
      },
    };
    const response = await POST(new NextRequest('http://localhost/api/v1/weekly/suggestions', {
      method: 'POST',
      headers: { 'idempotency-key': 'hermes-suggest-7' },
      body: JSON.stringify(payload),
    }));
    const body = await response.json();

    expect(runQueuedAutomationRouteMock).toHaveBeenCalledWith(expect.any(NextRequest), expect.objectContaining({
      scope: 'weekly:suggest',
      jobName: 'weekly.suggest',
      idempotencyKey: 'hermes-suggest-7',
      requestPayload: payload,
    }));
    expect(response.status).toBe(202);
    expect(body.data.status).toBe('queued');
  });

  it('queues empty Hermes artifacts for worker-side registration', async () => {
    const response = await POST(new NextRequest('http://localhost/api/v1/weekly/suggestions', {
      method: 'POST',
      headers: { 'idempotency-key': 'hermes-empty-7' },
      body: JSON.stringify({
        mode: 'register',
        provider: 'hermes',
        weeklyIssueId: 7,
        agentRunId: 'hermes_1',
        status: 'empty',
        items: [],
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body.data.status).toBe('queued');
  });

  it('rejects register payloads with secret-like fields', async () => {
    const response = await POST(new NextRequest('http://localhost/api/v1/weekly/suggestions', {
      method: 'POST',
      headers: { 'idempotency-key': 'hermes-secret-7' },
      body: JSON.stringify({
        mode: 'register',
        provider: 'hermes',
        weeklyIssueId: 7,
        agentRunId: 'hermes_1',
        token: 'wa_secret',
        items: [{ content_id: 10, section: 'AI' }],
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});
