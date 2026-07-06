import { describe, expect, it } from 'vitest';

import {
  AUTOMATION_QUEUE_NAME,
  getAutomationJobDefinition,
  getSubmittableAutomationJobDefinition,
} from './definitions';

describe('automation job definitions', () => {
  it('defines the shared automation queue name', () => {
    expect(AUTOMATION_QUEUE_NAME).toBe('automation');
  });

  it('maps source-specific sync to a data source target', () => {
    const definition = getSubmittableAutomationJobDefinition('sync.run');

    expect(definition).toMatchObject({
      workflow: 'sync',
      step: 'run',
      scope: 'sync:run',
      firstBatch: true,
      attempts: 2,
    });
    expect(definition.getTarget({ sourceId: 7 })).toEqual({
      targetType: 'data_source',
      targetId: '7',
      targetKey: 'data_source:7',
    });
  });

  it('maps all-source sync and score batch to stable targets', () => {
    expect(getSubmittableAutomationJobDefinition('sync.run').getTarget({})).toEqual({
      targetType: 'data_sources',
      targetId: 'all',
      targetKey: 'data_sources:all',
    });
    expect(getSubmittableAutomationJobDefinition('score.run').getTarget({ limit: 50 })).toEqual({
      targetType: 'inbox',
      targetId: 'score_batch',
      targetKey: 'inbox:score_batch',
    });
  });

  it('maps Karakeep resync to a content target', () => {
    const definition = getSubmittableAutomationJobDefinition('karakeep.resync');

    expect(definition).toMatchObject({
      workflow: 'content',
      step: 'karakeep_resync',
      scope: 'content:resync',
      firstBatch: true,
      attempts: 2,
    });
    expect(definition.getTarget({ contentId: 42 })).toEqual({
      targetType: 'content',
      targetId: '42',
      targetKey: 'content:42',
    });
  });

  it('registers weekly publish as a submittable weekly issue job', () => {
    const definition = getSubmittableAutomationJobDefinition('weekly.publish');

    expect(definition).toMatchObject({
      workflow: 'weekly',
      step: 'publish',
      scope: 'weekly:publish',
      firstBatch: true,
      attempts: 2,
    });
    expect(definition.getTarget({ weeklyIssueId: 7 })).toEqual({
      targetType: 'weekly_issue',
      targetId: '7',
      targetKey: 'weekly_issue:7',
    });
  });

  it('keeps weekly suggestion jobs reserved for later slices', () => {
    expect(getAutomationJobDefinition('weekly.suggest')).toMatchObject({
      workflow: 'weekly',
      step: 'suggest',
      firstBatch: false,
    });
    expect(() => getSubmittableAutomationJobDefinition('weekly.suggest')).toThrow(
      'Automation job weekly.suggest is reserved'
    );
  });
});
