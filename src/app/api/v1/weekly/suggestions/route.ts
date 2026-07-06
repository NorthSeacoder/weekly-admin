import { NextRequest } from 'next/server';
import { z } from 'zod';

import {
  automationErrorToResponse,
  getRequiredIdempotencyKey,
  runQueuedAutomationRoute,
} from '@/lib/automation/http';
import { normalizeWeeklySuggestionArtifact } from '@/lib/automation/hermes-artifacts';

const GenerateBodySchema = z.object({
  mode: z.enum(['generate']).optional(),
  weeklyIssueId: z.number().int().positive(),
  maxItems: z.number().int().positive().max(30).default(12),
});

const RegisterBodySchema = z.object({
  mode: z.literal('register'),
}).passthrough();

function getRegisterArtifactInput(body: z.infer<typeof RegisterBodySchema>) {
  if ('artifact' in body) return body.artifact;

  const { mode: _mode, ...artifact } = body;
  return artifact;
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json().catch(() => ({}));
    const mode = typeof rawBody === 'object' && rawBody !== null && 'mode' in rawBody
      ? (rawBody as { mode?: unknown }).mode
      : undefined;
    const body = mode === 'register'
      ? RegisterBodySchema.parse(rawBody)
      : GenerateBodySchema.parse(rawBody);
    if (body.mode === 'register') {
      normalizeWeeklySuggestionArtifact(getRegisterArtifactInput(body));
    }
    const idempotencyKey = getRequiredIdempotencyKey(request);

    return runQueuedAutomationRoute(request, {
      scope: 'weekly:suggest',
      jobName: 'weekly.suggest',
      idempotencyKey,
      requestPayload: body,
    });
  } catch (error) {
    return automationErrorToResponse(error);
  }
}
