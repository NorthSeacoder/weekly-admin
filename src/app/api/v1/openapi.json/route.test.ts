// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { GET } from './route';

describe('/api/v1/openapi.json', () => {
  it('exposes the automation contract document', async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.openapi).toBe('3.1.0');
    expect(body.components.securitySchemes.AutomationBearer).toMatchObject({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'automation-token',
    });
    expect(body['x-automation-scopes']).toEqual(expect.arrayContaining([
      'sync:run',
      'score:run',
      'content:resync',
      'weekly:read',
      'weekly:suggest',
      'weekly:publish',
      'ops:read',
    ]));
  });

  it('documents idempotency and response envelope for mutation endpoints', async () => {
    const body = await (await GET()).json();

    expect(body.paths['/jobs/sync'].post.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'Idempotency-Key',
        in: 'header',
        required: true,
      }),
    ]));
    expect(body.paths['/jobs/sync'].post.responses['202'].content['application/json'].schema.allOf[1].properties.data.$ref)
      .toBe('#/components/schemas/QueuedJobResult');
    expect(body.paths['/jobs/score'].post.description).toContain('Queues pending inbox scoring');
    expect(body.components.schemas.QueuedJobResult.properties).toHaveProperty('statusUrl');
    expect(body.components.schemas.AutomationEnvelope.properties.meta.properties).toHaveProperty('runId');
    expect(body.components.schemas.AutomationEnvelope.properties.meta.properties.status.enum).toEqual(expect.arrayContaining([
      'queued',
      'running',
      'cancelled',
    ]));
    expect(body.components.responses.IdempotencyConflict.description).toContain('Idempotency');
  });

  it('documents job status lookup with Redis history fallback', async () => {
    const body = await (await GET()).json();

    expect(body.paths['/jobs/{id}'].get.security).toEqual([
      { AutomationBearer: ['ops:read'] },
      { AutomationBearer: ['sync:run'] },
      { AutomationBearer: ['score:run'] },
      { AutomationBearer: ['content:resync'] },
      { AutomationBearer: ['weekly:suggest'] },
      { AutomationBearer: ['weekly:publish'] },
    ]);
    expect(body.paths['/jobs/{id}'].get.responses['200'].content['application/json'].schema.allOf[1].properties.data.$ref)
      .toBe('#/components/schemas/JobStatusResult');
    expect(body.components.schemas.JobStatusResult.properties.status.enum).toEqual(expect.arrayContaining([
      'queued',
      'running',
      'retrying',
      'failed',
    ]));
    expect(body.components.schemas.JobStatusResult.properties).toHaveProperty('historyOnly');
    expect(body.components.schemas.JobStatusResult.properties).toHaveProperty('redis');
    expect(body.components.schemas.JobStatusResult.properties).toHaveProperty('queue');
  });

  it('documents failed job retry endpoint', async () => {
    const body = await (await GET()).json();

    expect(body.paths['/jobs/{id}/retry'].post.security).toEqual([
      { AutomationBearer: ['sync:run'] },
      { AutomationBearer: ['score:run'] },
      { AutomationBearer: ['weekly:publish'] },
    ]);
    expect(body.paths['/jobs/{id}/retry'].post.description).toContain('weekly publish');
    expect(body.paths['/jobs/{id}/retry'].post.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Idempotency-Key', required: true }),
    ]));
    expect(body.paths['/jobs/{id}/retry'].post.responses['202'].content['application/json'].schema.allOf[1].properties.data.$ref)
      .toBe('#/components/schemas/RetryJobResult');
    expect(body.components.schemas.RetryJobResult.properties).toHaveProperty('retryOfRunId');
  });

  it('documents weekly publish as a queued automation job', async () => {
    const body = await (await GET()).json();

    expect(body.paths['/weekly/publish'].post.summary).toBe('Queue weekly publish');
    expect(body.paths['/weekly/publish'].post.responses['202'].content['application/json'].schema.allOf[1].properties.data.$ref)
      .toBe('#/components/schemas/QueuedJobResult');
  });

  it('documents current weekly issue discovery for Hermes callers', async () => {
    const body = await (await GET()).json();

    expect(body.paths['/weekly/current'].get.security).toEqual([
      { AutomationBearer: ['weekly:read'] },
    ]);
    expect(body.paths['/weekly/current'].get.description).toContain('without direct database access');
    expect(body.components.schemas.WeeklyCurrentResult.properties.issue.oneOf).toEqual(expect.arrayContaining([
      { type: 'null' },
      expect.objectContaining({
        properties: expect.objectContaining({
          issueNumber: { type: 'integer', minimum: 1 },
          linkedCount: { type: 'integer' },
        }),
      }),
    ]));
  });

  it('documents Hermes weekly suggestion register mode', async () => {
    const body = await (await GET()).json();

    expect(body.paths['/weekly/suggestions'].post.requestBody.content['application/json'].schema.oneOf)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          properties: expect.objectContaining({
            mode: expect.objectContaining({ enum: ['generate'] }),
          }),
        }),
        expect.objectContaining({
          required: ['mode', 'artifact'],
          properties: expect.objectContaining({
            artifact: { $ref: '#/components/schemas/WeeklySuggestionArtifact' },
          }),
        }),
      ]));
    expect(body.components.schemas.WeeklySuggestionArtifact.properties).toHaveProperty('agentRunId');
    expect(body.components.schemas.WeeklySuggestionResult.properties.provider.enum).toEqual(['hermes', 'admin']);
    expect(body.paths['/weekly/suggestions'].post.summary).toBe('Queue weekly organization suggestions');
    expect(body.paths['/weekly/suggestions'].post.responses['202'].content['application/json'].schema.allOf[1].properties.data.$ref)
      .toBe('#/components/schemas/QueuedJobResult');
    expect(body.paths['/weekly/suggestions/{id}/apply'].post.parameters[0].description).toContain('Weekly issue id');
    expect(body.paths['/weekly/suggestions/{id}/apply'].post.requestBody.content['application/json'].schema.properties)
      .toHaveProperty('sourceRunId');
    expect(body.paths['/weekly/suggestions/{id}/apply'].post.responses['202'].content['application/json'].schema.allOf[1].properties.data.$ref)
      .toBe('#/components/schemas/QueuedJobResult');
  });

  it('documents digest as ops read automation and score as human manual compatibility', async () => {
    const body = await (await GET()).json();

    expect(body.paths['/ai/feedback/digest'].get.security).toEqual([
      { AutomationBearer: ['ops:read'] },
    ]);
    expect(body.paths['/ai/score'].post.security).toEqual([
      { HumanBearer: [] },
    ]);
    expect(body.paths['/ai/score'].post.description).toContain('Automation callers should use /jobs/score');
  });
});
