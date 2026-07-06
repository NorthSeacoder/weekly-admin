// @vitest-environment node
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runAutomationRouteMock = vi.fn();
const getCurrentWeeklyIssueMock = vi.fn();

vi.mock('@/lib/automation/http', async () => {
  const actual = await vi.importActual<typeof import('@/lib/automation/http')>('@/lib/automation/http');
  return {
    ...actual,
    runAutomationRoute: (...args: unknown[]) => runAutomationRouteMock(...args),
  };
});

vi.mock('@/lib/automation/weekly-current', async () => {
  const actual = await vi.importActual<typeof import('@/lib/automation/weekly-current')>('@/lib/automation/weekly-current');
  return {
    ...actual,
    getCurrentWeeklyIssue: (...args: unknown[]) => getCurrentWeeklyIssueMock(...args),
  };
});

import { GET } from './route';

describe('/api/v1/weekly/current', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runAutomationRouteMock.mockImplementation(async (_request, options) => {
      const outcome = await options.handler();
      return Response.json({ success: true, data: outcome.result, meta: { status: outcome.status } });
    });
  });

  it('returns the current weekly issue through weekly read automation', async () => {
    getCurrentWeeklyIssueMock.mockResolvedValueOnce({
      status: 'succeeded',
      range: { startDate: '2026-07-05', endDate: '2026-07-11' },
      issue: { id: 92, issueNumber: 92, slug: 'issue-92' },
    });

    const response = await GET(new NextRequest('http://localhost/api/v1/weekly/current?weekOffset=0'));
    const body = await response.json();

    expect(runAutomationRouteMock).toHaveBeenCalledWith(expect.any(NextRequest), expect.objectContaining({
      scope: 'weekly:read',
      workflow: 'weekly',
      step: 'current_issue',
    }));
    expect(getCurrentWeeklyIssueMock).toHaveBeenCalledWith({ weekOffset: 0, date: undefined });
    expect(body.data.issue.id).toBe(92);
  });
});
