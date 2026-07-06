import { NextRequest } from 'next/server';
import { z } from 'zod';

import {
  automationErrorToResponse,
  getRequiredIdempotencyKey,
  runQueuedAutomationRoute,
} from '@/lib/automation/http';
import { SuggestionApplySchema } from '@/lib/automation/weekly-suggestions';

const ParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = ParamsSchema.parse(await params);
    const body = SuggestionApplySchema.parse({
      ...(await request.json().catch(() => ({}))),
      weeklyIssueId: resolvedParams.id,
    });
    const idempotencyKey = getRequiredIdempotencyKey(request);

    return runQueuedAutomationRoute(request, {
      scope: 'weekly:suggest',
      jobName: 'weekly.apply',
      idempotencyKey,
      requestPayload: body,
    });
  } catch (error) {
    return automationErrorToResponse(error);
  }
}
