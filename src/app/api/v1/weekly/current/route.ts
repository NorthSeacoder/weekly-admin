import { NextRequest } from 'next/server';

import { automationErrorToResponse, getReadOnlyIdempotencyKey, runAutomationRoute } from '@/lib/automation/http';
import { getCurrentWeeklyIssue, WeeklyCurrentQuerySchema } from '@/lib/automation/weekly-current';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const query = WeeklyCurrentQuerySchema.parse({
      weekOffset: url.searchParams.get('weekOffset') ?? undefined,
      date: url.searchParams.get('date') ?? undefined,
    });

    return runAutomationRoute(request, {
      scope: 'weekly:read',
      workflow: 'weekly',
      step: 'current_issue',
      idempotencyKey: getReadOnlyIdempotencyKey(request),
      requestPayload: query,
      handler: async () => {
        const result = await getCurrentWeeklyIssue(query);
        return {
          status: result.status,
          result,
        };
      },
    });
  } catch (error) {
    return automationErrorToResponse(error);
  }
}
