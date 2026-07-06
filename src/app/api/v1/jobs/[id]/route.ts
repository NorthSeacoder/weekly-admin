import { NextRequest } from 'next/server';
import { z } from 'zod';

import { AutomationAuthError, authenticateAutomationRequest, type AutomationCaller, type AutomationScope } from '@/lib/automation/auth';
import { automationErrorToResponse, AutomationRouteError } from '@/lib/automation/http';
import { createAutomationSuccessResponse, getCallerMeta } from '@/lib/automation/contracts';
import { getAutomationJobStatus, type AutomationJobStatus } from '@/lib/jobs/status';

const ParamsSchema = z.object({
  id: z.string().min(1).max(64),
});

const WORKFLOW_READ_SCOPES: Record<string, AutomationScope[]> = {
  sync: ['sync:run'],
  score: ['score:run'],
  content: ['content:resync'],
  weekly: ['weekly:read', 'weekly:suggest', 'weekly:publish'],
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const caller = await authenticateAutomationRequest(request);
    const { id } = ParamsSchema.parse(await params);
    const status = await getAutomationJobStatus(id);
    if (!status) {
      throw new AutomationRouteError('JOB_NOT_FOUND', 'Automation job was not found', 404);
    }

    assertCanReadJobStatus(caller, status);

    return createAutomationSuccessResponse(status, {
      runId: status.runId,
      status: status.durableStatus,
      caller: getCallerMeta(caller),
    });
  } catch (error) {
    return automationErrorToResponse(error);
  }
}

function assertCanReadJobStatus(caller: AutomationCaller, status: AutomationJobStatus): void {
  if (caller.scopes.includes('ops:read')) return;

  const allowedScopes = WORKFLOW_READ_SCOPES[status.workflow] ?? [];
  if (allowedScopes.some((scope) => caller.scopes.includes(scope))) return;

  throw new AutomationAuthError('AUTOMATION_SCOPE_FORBIDDEN', 'Automation token scope is not allowed', 403);
}
