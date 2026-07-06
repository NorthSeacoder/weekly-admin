import { NextRequest } from 'next/server';
import { z } from 'zod';

import {
  automationErrorToResponse,
  getRequiredIdempotencyKey,
  runQueuedAutomationRoute,
} from '@/lib/automation/http';

const BodySchema = z.object({
  weeklyIssueId: z.number().int().positive(),
  forceRepublish: z.boolean().optional().default(false),
  deliver: z.boolean().optional().default(false),
});

export async function POST(request: NextRequest) {
  try {
    const body = BodySchema.parse(await request.json().catch(() => ({})));
    const idempotencyKey = getRequiredIdempotencyKey(request);

    return runQueuedAutomationRoute(request, {
      scope: 'weekly:publish',
      jobName: 'weekly.publish',
      idempotencyKey,
      requestPayload: body,
    });
  } catch (error) {
    return automationErrorToResponse(error);
  }
}
