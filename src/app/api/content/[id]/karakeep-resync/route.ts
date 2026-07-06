import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { authenticateRequest } from '@/lib/auth';
import { authenticateAutomationTokenValue } from '@/lib/automation/auth';
import { automationErrorToResponse, AutomationRouteError } from '@/lib/automation/http';
import { submitAutomationJob } from '@/lib/jobs/submit';
import { createNextErrorResponse, createNextSuccessResponse } from '@/lib/utils/serialization';
import { ContentService } from '@/lib/services/content';
import { getKarakeepResyncStatus, type KarakeepResyncJob, type KarakeepResyncPayload } from '@/lib/services/karakeep-resync';

const MIN_ATTEMPTS = 6;
const MAX_ATTEMPTS = 30;

function normalizeAttempts(raw?: number): number {
  if (!raw || Number.isNaN(raw)) return 12;
  return Math.min(Math.max(raw, MIN_ATTEMPTS), MAX_ATTEMPTS);
}

function getServerAutomationToken() {
  return process.env.ADMIN_UI_AUTOMATION_TOKEN?.trim() || process.env.CRON_API_TOKEN?.trim() || null;
}

async function getInternalAutomationCaller() {
  const token = getServerAutomationToken();
  if (!token) {
    throw new AutomationRouteError(
      'ADMIN_UI_AUTOMATION_TOKEN_MISSING',
      'Karakeep resync requires ADMIN_UI_AUTOMATION_TOKEN or CRON_API_TOKEN with content:resync scope',
      500
    );
  }

  return authenticateAutomationTokenValue(token, 'content:resync');
}

function getOptionalIdempotencyKey(request: NextRequest, contentId: number) {
  return request.headers.get('idempotency-key')?.trim() || `karakeep-resync:${contentId}:${randomUUID()}`;
}

function queuedJobToResyncJob(
  job: { runId: string; statusUrl: string },
  payload: KarakeepResyncPayload
): KarakeepResyncJob {
  return {
    jobId: job.runId,
    runId: job.runId,
    contentId: payload.contentId,
    karakeepId: payload.karakeepId,
    phase: 'updating',
    attempt: 0,
    maxAttempts: payload.maxAttempts,
    refreshScreenshot: payload.refreshScreenshot,
    screenshotLocked: payload.screenshotLocked,
    appliedImage: null,
    updatedAt: new Date().toISOString(),
    statusUrl: job.statusUrl,
  };
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success || !authResult.user) {
      return createNextErrorResponse('UNAUTHORIZED', '未授权访问', 401);
    }

    const { id } = await params;
    const contentId = parseInt(id, 10);
    if (Number.isNaN(contentId)) {
      return createNextErrorResponse('INVALID_ID', '无效的内容ID', 400);
    }

    const body = await request.json().catch(() => ({}));
    const refreshScreenshot = Boolean(body.refreshScreenshot);
    const maxAttempts = normalizeAttempts(body.maxAttempts);

    const content = await ContentService.getContentById(contentId);
    if (!content) {
      return createNextErrorResponse('NOT_FOUND', '内容不存在', 404);
    }

    const karakeepIdAttr = content.attributes?.find(attr => attr.attribute_name === 'karakeep_id');
    const karakeepId = karakeepIdAttr?.attribute_value;
    if (!karakeepId) {
      return createNextErrorResponse('NO_KARAKEEP_ID', '内容未绑定 Karakeep ID', 400);
    }

    if (!content.source_url) {
      return createNextErrorResponse('NO_SOURCE_URL', '缺少 source_url，无法通知 Karakeep', 400);
    }

    const screenshotLocked = content.screenshot_api === 'manual';
    const payload: KarakeepResyncPayload = {
      contentId,
      karakeepId,
      sourceUrl: content.source_url,
      refreshScreenshot: refreshScreenshot && !screenshotLocked,
      screenshotLocked,
      maxAttempts,
    };
    const caller = await getInternalAutomationCaller();
    const job = await submitAutomationJob({
      caller,
      jobName: 'karakeep.resync',
      idempotencyKey: getOptionalIdempotencyKey(request, contentId),
      payload,
    });

    return createNextSuccessResponse(queuedJobToResyncJob(job, payload), job.idempotentReplay ? 200 : 202, {
      runId: job.runId,
      status: job.status,
      idempotentReplay: job.idempotentReplay,
      caller: job.caller,
    });
  } catch (error: unknown) {
    const errorName = error instanceof Error ? error.name : '';
    if (error instanceof AutomationRouteError || errorName.startsWith('Automation') || errorName === 'JobSubmissionError') {
      return automationErrorToResponse(error);
    }
    console.error('启动 Karakeep 重跑失败:', error);
    return createNextErrorResponse('RESYNC_START_FAILED', '启动 Karakeep 重跑失败', 500, getErrorMessage(error));
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success || !authResult.user) {
      return createNextErrorResponse('UNAUTHORIZED', '未授权访问', 401);
    }

    const { id } = await params;
    const contentId = parseInt(id, 10);
    if (Number.isNaN(contentId)) {
      return createNextErrorResponse('INVALID_ID', '无效的内容ID', 400);
    }

    const url = new URL(request.url);
    const jobId = url.searchParams.get('jobId');
    if (!jobId) {
      return createNextErrorResponse('MISSING_JOB_ID', '缺少 jobId', 400);
    }

    const job = await getKarakeepResyncStatus(jobId);
    if (!job) {
      return createNextErrorResponse('JOB_NOT_FOUND', '未找到对应的任务', 404);
    }

    if (job.contentId !== contentId) {
      return createNextErrorResponse('JOB_MISMATCH', '任务与内容不匹配', 400);
    }

    return createNextSuccessResponse(job);
  } catch (error: unknown) {
    console.error('查询 Karakeep 重跑状态失败:', error);
    return createNextErrorResponse('RESYNC_STATUS_FAILED', '查询 Karakeep 重跑状态失败', 500, getErrorMessage(error));
  }
}
