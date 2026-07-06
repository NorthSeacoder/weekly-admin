export const AUTOMATION_QUEUE_NAME = 'automation';

export type AutomationJobName =
  | 'sync.run'
  | 'score.run'
  | 'karakeep.resync'
  | 'weekly.suggest'
  | 'weekly.apply'
  | 'weekly.publish';

export type AutomationJobWorkflow = 'sync' | 'score' | 'content' | 'weekly';

export type AutomationJobDefinition = {
  workflow: AutomationJobWorkflow;
  step: string;
  jobName: AutomationJobName;
  scope: 'sync:run' | 'score:run' | 'content:resync' | 'weekly:suggest' | 'weekly:publish';
  firstBatch: boolean;
  attempts: number;
  backoff: {
    type: 'fixed' | 'exponential';
    delay: number;
  };
  rateLimit: {
    limit: number;
    windowMs: number;
  };
  getTarget: (payload: Record<string, unknown>) => AutomationJobTarget;
};

export type AutomationJobTarget = {
  targetType: string;
  targetId: string;
  targetKey: string;
};

export const AUTOMATION_JOB_DEFINITIONS: Record<AutomationJobName, AutomationJobDefinition> = {
  'sync.run': {
    workflow: 'sync',
    step: 'run',
    jobName: 'sync.run',
    scope: 'sync:run',
    firstBatch: true,
    attempts: 2,
    backoff: { type: 'exponential', delay: 30_000 },
    rateLimit: { limit: 10, windowMs: 60_000 },
    getTarget: (payload) => {
      const sourceId = payload.sourceId;
      if (typeof sourceId === 'number' && Number.isInteger(sourceId) && sourceId > 0) {
        return {
          targetType: 'data_source',
          targetId: String(sourceId),
          targetKey: `data_source:${sourceId}`,
        };
      }

      return {
        targetType: 'data_sources',
        targetId: 'all',
        targetKey: 'data_sources:all',
      };
    },
  },
  'score.run': {
    workflow: 'score',
    step: 'run',
    jobName: 'score.run',
    scope: 'score:run',
    firstBatch: true,
    attempts: 2,
    backoff: { type: 'exponential', delay: 30_000 },
    rateLimit: { limit: 20, windowMs: 60_000 },
    getTarget: () => ({
      targetType: 'inbox',
      targetId: 'score_batch',
      targetKey: 'inbox:score_batch',
    }),
  },
  'karakeep.resync': {
    workflow: 'content',
    step: 'karakeep_resync',
    jobName: 'karakeep.resync',
    scope: 'content:resync',
    firstBatch: true,
    attempts: 2,
    backoff: { type: 'exponential', delay: 30_000 },
    rateLimit: { limit: 10, windowMs: 60_000 },
    getTarget: (payload) => {
      const contentId = payload.contentId;
      return {
        targetType: 'content',
        targetId: contentId === undefined ? 'unknown' : String(contentId),
        targetKey: `content:${contentId === undefined ? 'unknown' : contentId}`,
      };
    },
  },
  'weekly.suggest': {
    workflow: 'weekly',
    step: 'suggest',
    jobName: 'weekly.suggest',
    scope: 'weekly:suggest',
    firstBatch: true,
    attempts: 2,
    backoff: { type: 'exponential', delay: 30_000 },
    rateLimit: { limit: 5, windowMs: 60_000 },
    getTarget: weeklyIssueTarget,
  },
  'weekly.apply': {
    workflow: 'weekly',
    step: 'apply',
    jobName: 'weekly.apply',
    scope: 'weekly:suggest',
    firstBatch: true,
    attempts: 2,
    backoff: { type: 'exponential', delay: 30_000 },
    rateLimit: { limit: 10, windowMs: 60_000 },
    getTarget: weeklyIssueTarget,
  },
  'weekly.publish': {
    workflow: 'weekly',
    step: 'publish',
    jobName: 'weekly.publish',
    scope: 'weekly:publish',
    firstBatch: true,
    attempts: 2,
    backoff: { type: 'exponential', delay: 30_000 },
    rateLimit: { limit: 3, windowMs: 60_000 },
    getTarget: weeklyIssueTarget,
  },
};

export function getAutomationJobDefinition(jobName: AutomationJobName): AutomationJobDefinition {
  return AUTOMATION_JOB_DEFINITIONS[jobName];
}

export function getSubmittableAutomationJobDefinition(jobName: AutomationJobName): AutomationJobDefinition {
  const definition = getAutomationJobDefinition(jobName);
  if (!definition.firstBatch) {
    throw new Error(`Automation job ${jobName} is reserved and cannot be submitted in this feature slice`);
  }
  return definition;
}

function weeklyIssueTarget(payload: Record<string, unknown>): AutomationJobTarget {
  const artifact = payload.artifact && typeof payload.artifact === 'object'
    ? payload.artifact as Record<string, unknown>
    : undefined;
  const weeklyIssueId = payload.weeklyIssueId ?? payload.issueId ?? artifact?.weeklyIssueId;
  return {
    targetType: 'weekly_issue',
    targetId: weeklyIssueId === undefined ? 'unknown' : String(weeklyIssueId),
    targetKey: `weekly_issue:${weeklyIssueId === undefined ? 'unknown' : weeklyIssueId}`,
  };
}
