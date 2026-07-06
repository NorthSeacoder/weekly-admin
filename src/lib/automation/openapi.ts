export function getAutomationOpenApiDocument() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Weekly Admin Automation API',
      version: '1.0.0',
      description: 'Agent-friendly API contract for external automation and workflow replay.',
    },
    servers: [
      {
        url: '/api/v1',
      },
    ],
    security: [
      {
        AutomationBearer: [],
      },
    ],
    tags: [
      { name: 'Jobs' },
      { name: 'Weekly' },
      { name: 'AI' },
      { name: 'Contract' },
    ],
    paths: {
      '/jobs/sync': {
        post: {
          tags: ['Jobs'],
          summary: 'Queue source sync',
          description: 'Queues one or more data-source sync jobs. Requires an Idempotency-Key header and returns queued job status quickly.',
          security: [{ AutomationBearer: ['sync:run'] }],
          parameters: [idempotencyHeader()],
          requestBody: jsonBody({
            type: 'object',
            properties: {
              sourceId: { type: 'integer', minimum: 1 },
              type: { type: 'string', enum: ['rss', 'karakeep', 'webhook', 'manual'] },
              max_items: { type: 'integer', minimum: 1, maximum: 500 },
              similarity_check: { type: 'boolean' },
              auto_preprocess: { type: 'boolean' },
              incremental: { type: 'boolean' },
              only_due: { type: 'boolean' },
            },
            additionalProperties: false,
          }),
          responses: automationResponses('QueuedJobResult', 202),
        },
      },
      '/jobs/score': {
        post: {
          tags: ['Jobs'],
          summary: 'Queue inbox scoring batch',
          description: 'Queues pending inbox scoring in a bounded batch. Requires an Idempotency-Key header and returns queued job status quickly.',
          security: [{ AutomationBearer: ['score:run'] }],
          parameters: [idempotencyHeader()],
          requestBody: jsonBody({
            type: 'object',
            properties: {
              limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
              delay: { type: 'integer', minimum: 0, maximum: 5000, default: 0 },
            },
            additionalProperties: false,
          }),
          responses: automationResponses('QueuedJobResult', 202),
        },
      },
      '/jobs/{id}': {
        get: {
          tags: ['Jobs'],
          summary: 'Read automation job status',
          description: 'Returns durable automation run history merged with retained Redis/BullMQ runtime status. If Redis status expired, data.historyOnly is true.',
          security: [
            { AutomationBearer: ['ops:read'] },
            { AutomationBearer: ['sync:run'] },
            { AutomationBearer: ['score:run'] },
            { AutomationBearer: ['content:resync'] },
            { AutomationBearer: ['weekly:suggest'] },
            { AutomationBearer: ['weekly:publish'] },
          ],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string', minLength: 1, maxLength: 64 },
              description: 'Automation run/job id.',
            },
          ],
          responses: automationResponses('JobStatusResult'),
        },
      },
      '/jobs/{id}/retry': {
        post: {
          tags: ['Jobs'],
          summary: 'Retry failed automation job',
          description: 'Creates a new queued run for a failed sync/score/weekly publish job when the original BullMQ payload is still retained. Requires the same workflow scope and an Idempotency-Key header.',
          security: [
            { AutomationBearer: ['sync:run'] },
            { AutomationBearer: ['score:run'] },
            { AutomationBearer: ['weekly:publish'] },
          ],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string', minLength: 1, maxLength: 64 },
              description: 'Original failed automation run/job id.',
            },
            idempotencyHeader(),
          ],
          responses: automationResponses('RetryJobResult', 202),
        },
      },
      '/weekly/candidates': {
        get: {
          tags: ['Weekly'],
          summary: 'List weekly candidates',
          description: 'Returns candidate inbox/content items for a weekly issue preview.',
          security: [{ AutomationBearer: ['weekly:read'] }],
          parameters: [
            queryParam('weekOffset', { type: 'integer', default: 0 }),
            queryParam('date', { type: 'string', format: 'date' }),
            queryParam('limit', { type: 'integer', minimum: 1, maximum: 100 }),
            queryParam('status', { type: 'string' }),
          ],
          responses: automationResponses('WeeklyCandidatesResult'),
        },
      },
      '/weekly/current': {
        get: {
          tags: ['Weekly'],
          summary: 'Read current weekly issue',
          description: 'Returns the weekly issue covering a target week. This lets Hermes and other agents discover weeklyIssueId without direct database access.',
          security: [{ AutomationBearer: ['weekly:read'] }],
          parameters: [
            queryParam('weekOffset', { type: 'integer', default: 0 }),
            queryParam('date', { type: 'string', format: 'date' }),
          ],
          responses: automationResponses('WeeklyCurrentResult'),
        },
      },
      '/weekly/suggestions': {
        post: {
          tags: ['Weekly'],
          summary: 'Queue weekly organization suggestions',
          description: 'Queues Admin suggestion generation or Hermes preview artifact registration. The worker records a preview only; it does not write weekly_content_items.',
          security: [{ AutomationBearer: ['weekly:suggest'] }],
          parameters: [idempotencyHeader()],
          requestBody: jsonBody({
            oneOf: [
              {
                type: 'object',
                required: ['weeklyIssueId'],
                properties: {
                  mode: { type: 'string', enum: ['generate'], default: 'generate' },
                  weeklyIssueId: { type: 'integer', minimum: 1 },
                  maxItems: { type: 'integer', minimum: 1, maximum: 30, default: 12 },
                },
                additionalProperties: false,
              },
              {
                type: 'object',
                required: ['mode', 'artifact'],
                properties: {
                  mode: { type: 'string', enum: ['register'] },
                  artifact: { $ref: '#/components/schemas/WeeklySuggestionArtifact' },
                },
                additionalProperties: false,
              },
              {
                allOf: [
                  { $ref: '#/components/schemas/WeeklySuggestionArtifact' },
                  {
                    type: 'object',
                    required: ['mode'],
                    properties: {
                      mode: { type: 'string', enum: ['register'] },
                    },
                  },
                ],
              },
            ],
          }),
          responses: automationResponses('QueuedJobResult', 202),
        },
      },
      '/weekly/suggestions/{id}/apply': {
        post: {
          tags: ['Weekly'],
          summary: 'Queue weekly organization suggestion apply',
          description: 'Queues applying a preview suggestion payload to weekly_content_items and preserves section/featured fields.',
          security: [{ AutomationBearer: ['weekly:suggest'] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'integer', minimum: 1 },
              description: 'Weekly issue id.',
            },
            idempotencyHeader(),
          ],
          requestBody: jsonBody({
            type: 'object',
            required: ['items'],
            properties: {
              replaceExisting: { type: 'boolean', default: false },
              sourceRunId: { type: 'string', maxLength: 160 },
              agentRunId: { type: 'string', maxLength: 160 },
              items: {
                type: 'array',
                minItems: 1,
                maxItems: 30,
                items: {
                  type: 'object',
                  required: ['content_id', 'section'],
                  properties: {
                    content_id: { type: 'integer', minimum: 1 },
                    section: { type: 'string', minLength: 1, maxLength: 100 },
                    featured: { type: 'boolean', default: false },
                    reason: { type: 'string', maxLength: 200 },
                  },
                },
              },
            },
            additionalProperties: false,
          }),
          responses: automationResponses('QueuedJobResult', 202),
        },
      },
      '/weekly/publish': {
        post: {
          tags: ['Weekly'],
          summary: 'Queue weekly publish',
          description: 'Queues a weekly issue publish job for Quail. Already-published issues fail in the worker unless forceRepublish is true.',
          security: [{ AutomationBearer: ['weekly:publish'] }],
          parameters: [idempotencyHeader()],
          requestBody: jsonBody({
            type: 'object',
            required: ['weeklyIssueId'],
            properties: {
              weeklyIssueId: { type: 'integer', minimum: 1 },
              forceRepublish: { type: 'boolean', default: false },
              deliver: { type: 'boolean', default: false },
            },
            additionalProperties: false,
          }),
          responses: automationResponses('QueuedJobResult', 202),
        },
      },
      '/ai/feedback/digest': {
        get: {
          tags: ['AI'],
          summary: 'Read AI feedback digest',
          description: 'Aggregates inbox action feedback from operation logs for scoring review.',
          security: [{ AutomationBearer: ['ops:read'] }],
          parameters: [
            queryParam('from', { type: 'string', format: 'date-time' }),
            queryParam('to', { type: 'string', format: 'date-time' }),
            queryParam('format', { type: 'string', enum: ['json', 'markdown'], default: 'json' }),
          ],
          responses: automationResponses('FeedbackDigestResult'),
        },
      },
      '/ai/score': {
        post: {
          tags: ['AI'],
          summary: 'Manual single-item scoring',
          description: 'Compatibility endpoint for human-admin JWT flows. Automation callers should use /jobs/score.',
          security: [{ HumanBearer: [] }],
          requestBody: jsonBody({
            type: 'object',
            required: ['inbox_id'],
            properties: {
              inbox_id: { type: 'string', pattern: '^[0-9]+$' },
              force: { type: 'boolean', default: false },
            },
            additionalProperties: false,
          }),
          responses: standardResponses('ManualScoreResult'),
        },
      },
      '/openapi.json': {
        get: {
          tags: ['Contract'],
          summary: 'Read OpenAPI contract',
          security: [],
          responses: {
            '200': {
              description: 'OpenAPI document',
            },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        AutomationBearer: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'automation-token',
          description: 'Use an automation token created by scripts/create-automation-token.ts.',
        },
        HumanBearer: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Human admin JWT used by legacy/manual admin endpoints.',
        },
      },
      schemas: {
        AutomationEnvelope: automationEnvelopeSchema(),
        ErrorEnvelope: errorEnvelopeSchema(),
        QueuedJobResult: statusObjectSchema({
          jobId: { type: 'string' },
          runId: { type: 'string' },
          workflow: { type: 'string' },
          step: { type: 'string' },
          target: { type: 'object', additionalProperties: true },
          statusUrl: { type: 'string' },
          idempotentReplay: { type: 'boolean' },
        }),
        RetryJobResult: statusObjectSchema({
          jobId: { type: 'string' },
          runId: { type: 'string' },
          retryOfRunId: { type: 'string' },
          workflow: { type: 'string' },
          step: { type: 'string' },
          target: { type: 'object', additionalProperties: true },
          statusUrl: { type: 'string' },
          idempotentReplay: { type: 'boolean' },
        }),
        JobStatusResult: {
          type: 'object',
          required: ['runId', 'status', 'durableStatus', 'historyOnly', 'workflow', 'step', 'redis', 'queue'],
          properties: {
            runId: { type: 'string' },
            status: { type: 'string', enum: [...automationRunStatusEnum, 'retrying'] },
            durableStatus: { type: 'string', enum: automationRunStatusEnum },
            historyOnly: { type: 'boolean' },
            workflow: { type: 'string' },
            step: { type: 'string' },
            targetType: { type: ['string', 'null'] },
            targetId: { type: ['string', 'null'] },
            startedAt: { type: ['string', 'null'], format: 'date-time' },
            finishedAt: { type: ['string', 'null'], format: 'date-time' },
            resultSummary: { type: ['object', 'array', 'string', 'number', 'boolean', 'null'] },
            errorCode: { type: ['string', 'null'] },
            errorMessage: { type: ['string', 'null'] },
            redis: {
              type: 'object',
              properties: {
                available: { type: 'boolean' },
                statusExpired: { type: 'boolean' },
                error: { type: 'string' },
                snapshot: { type: 'object', additionalProperties: true },
              },
              additionalProperties: true,
            },
            queue: {
              type: 'object',
              properties: {
                available: { type: 'boolean' },
                state: { type: ['string', 'null'] },
                attemptsMade: { type: ['integer', 'null'] },
                attempts: { type: ['integer', 'null'] },
                error: { type: 'string' },
              },
              additionalProperties: true,
            },
          },
          additionalProperties: true,
        },
        SyncResult: statusObjectSchema(),
        ScoreResult: statusObjectSchema(),
        WeeklyCurrentResult: {
          type: 'object',
          required: ['status', 'range', 'issue'],
          properties: {
            status: { type: 'string', enum: ['succeeded', 'empty'] },
            range: {
              type: 'object',
              required: ['startDate', 'endDate'],
              properties: {
                startDate: { type: 'string', format: 'date' },
                endDate: { type: 'string', format: 'date' },
              },
              additionalProperties: false,
            },
            issue: {
              oneOf: [
                { type: 'null' },
                {
                  type: 'object',
                  required: ['id', 'issueNumber', 'title', 'slug', 'status', 'startDate', 'endDate', 'linkedCount'],
                  properties: {
                    id: { type: 'integer', minimum: 1 },
                    issueNumber: { type: 'integer', minimum: 1 },
                    title: { type: 'string' },
                    slug: { type: 'string' },
                    status: { type: 'string' },
                    startDate: { type: 'string', format: 'date' },
                    endDate: { type: 'string', format: 'date' },
                    totalItems: { type: 'integer' },
                    linkedCount: { type: 'integer' },
                    quailPostId: { type: ['string', 'null'] },
                    quailPostSlug: { type: ['string', 'null'] },
                    publishedAt: { type: ['string', 'null'], format: 'date-time' },
                  },
                  additionalProperties: false,
                },
              ],
            },
          },
          additionalProperties: false,
        },
        WeeklyCandidatesResult: statusObjectSchema(),
        WeeklySuggestionArtifact: weeklySuggestionArtifactSchema(),
        WeeklySuggestionResult: {
          type: 'object',
          required: ['status', 'weeklyIssueId', 'provider', 'suggestion'],
          properties: {
            status: { type: 'string', enum: ['preview', 'empty', 'stale', 'rejected'] },
            weeklyIssueId: { type: 'integer', minimum: 1 },
            provider: { type: 'string', enum: ['hermes', 'admin'] },
            artifactVersion: { type: 'string', enum: ['weekly-suggestion.v1'] },
            agentRunId: { type: 'string' },
            sourceRunId: { type: 'string' },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            evidenceRefs: { type: 'array', items: evidenceRefSchema() },
            preferenceRefs: { type: 'array', items: { type: 'string' } },
            generatedAt: { type: 'string', format: 'date-time' },
            expiresAt: { type: 'string', format: 'date-time' },
            suggestion: {
              type: 'object',
              required: ['items'],
              properties: {
                intro: { type: 'string', maxLength: 1000 },
                items: {
                  type: 'array',
                  maxItems: 30,
                  items: weeklySuggestionItemSchema(),
                },
              },
              additionalProperties: false,
            },
          },
          additionalProperties: false,
        },
        WeeklySuggestionApplyResult: statusObjectSchema(),
        WeeklyPublishResult: statusObjectSchema({
          quailPostId: { type: 'string' },
          quailPostSlug: { type: 'string' },
        }),
        FeedbackDigestResult: statusObjectSchema({
          actions: { type: 'array', items: { type: 'object', additionalProperties: true } },
          counts: { type: 'object', additionalProperties: { type: 'integer' } },
        }),
        ManualScoreResult: {
          type: 'object',
          properties: {
            scored: { type: 'boolean' },
            score: { type: ['number', 'null'] },
            promoted: { type: 'boolean' },
            content_id: { type: 'string' },
            error: { type: 'string' },
          },
          additionalProperties: true,
        },
      },
      headers: {
        IdempotencyKey: {
          description: 'Required for mutation endpoints. Reusing the same key and payload returns an idempotent replay.',
          schema: { type: 'string', minLength: 1, maxLength: 160 },
        },
      },
      responses: {
        Unauthorized: errorResponse('Automation token is missing or invalid.'),
        Forbidden: errorResponse('Automation token does not include the required scope.'),
        ValidationError: errorResponse('Request validation failed.'),
        IdempotencyConflict: errorResponse('Idempotency key is missing, already running, or reused with different payload.'),
      },
    },
    'x-automation-scopes': [
      'sync:run',
      'score:run',
      'content:resync',
      'weekly:read',
      'weekly:suggest',
      'weekly:publish',
      'ops:read',
    ],
    'x-contract-notes': {
      responseEnvelope: 'All automation endpoints return success/data/error/meta.',
      idempotency: 'Mutation endpoints require Idempotency-Key. Read endpoints derive a read-only key from the URL.',
      secretRedaction: 'Responses include tokenPrefix only and never return token hashes or full token values.',
    },
  };
}

const automationRunStatusEnum = [
  'queued',
  'running',
  'succeeded',
  'partial_success',
  'skipped',
  'empty',
  'failed',
  'cancelled',
];

function idempotencyHeader() {
  return {
    name: 'Idempotency-Key',
    in: 'header',
    required: true,
    schema: { type: 'string', minLength: 1, maxLength: 160 },
    description: 'Required for mutation endpoints.',
  };
}

function queryParam(name: string, schema: Record<string, unknown>) {
  return {
    name,
    in: 'query',
    required: false,
    schema,
  };
}

function jsonBody(schema: Record<string, unknown>) {
  return {
    required: true,
    content: {
      'application/json': {
        schema,
      },
    },
  };
}

function automationResponses(schemaName: string, successStatus: 200 | 202 = 200) {
  return standardResponses(schemaName, true, successStatus);
}

function standardResponses(schemaName: string, automation = false, successStatus: 200 | 202 = 200) {
  return {
    [String(successStatus)]: {
      description: 'Successful response',
      content: {
        'application/json': {
          schema: {
            allOf: [
              { $ref: '#/components/schemas/AutomationEnvelope' },
              {
                type: 'object',
                properties: {
                  data: { $ref: `#/components/schemas/${schemaName}` },
                },
              },
            ],
          },
        },
      },
    },
    '400': { $ref: '#/components/responses/ValidationError' },
    ...(automation
      ? {
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '409': { $ref: '#/components/responses/IdempotencyConflict' },
        }
      : {
          '401': { $ref: '#/components/responses/Unauthorized' },
        }),
    '500': errorResponse('Internal server error.'),
  };
}

function automationEnvelopeSchema() {
  return {
    type: 'object',
    required: ['success', 'data'],
    properties: {
      success: { type: 'boolean', const: true },
      data: { type: 'object' },
      meta: {
        type: 'object',
        properties: {
          timestamp: { type: 'string', format: 'date-time' },
          runId: { type: 'string' },
          status: { type: 'string', enum: automationRunStatusEnum },
          idempotentReplay: { type: 'boolean' },
          caller: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              tokenPrefix: { type: 'string' },
            },
          },
        },
        additionalProperties: true,
      },
    },
    additionalProperties: false,
  };
}

function errorEnvelopeSchema() {
  return {
    type: 'object',
    required: ['success', 'error', 'meta'],
    properties: {
      success: { type: 'boolean', const: false },
      error: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: { type: 'string' },
          message: { type: 'string' },
          details: {},
        },
      },
      meta: {
        type: 'object',
        properties: {
          timestamp: { type: 'string', format: 'date-time' },
        },
        additionalProperties: true,
      },
    },
  };
}

function statusObjectSchema(extraProperties: Record<string, unknown> = {}) {
  return {
    type: 'object',
    required: ['status'],
    properties: {
      status: { type: 'string', enum: automationRunStatusEnum },
      ...extraProperties,
    },
    additionalProperties: true,
  };
}

function evidenceRefSchema() {
  return {
    type: 'object',
    properties: {
      type: { type: 'string', maxLength: 80 },
      sourceType: { type: 'string', maxLength: 80 },
      sourceId: { oneOf: [{ type: 'string', maxLength: 160 }, { type: 'integer' }] },
      label: { type: 'string', maxLength: 160 },
      summary: { type: 'string', maxLength: 500 },
      runId: { type: 'string', maxLength: 160 },
    },
    additionalProperties: false,
  };
}

function weeklySuggestionItemSchema() {
  return {
    type: 'object',
    required: ['content_id', 'section'],
    properties: {
      content_id: { type: 'integer', minimum: 1 },
      section: { type: 'string', minLength: 1, maxLength: 100 },
      featured: { type: 'boolean', default: false },
      reason: { type: 'string', maxLength: 200 },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      evidenceRefs: { type: 'array', items: evidenceRefSchema(), maxItems: 20 },
      title: { type: 'string', maxLength: 300 },
      source_url: { type: ['string', 'null'], maxLength: 1000 },
      original_score: { type: ['number', 'null'] },
      summary_score: { type: ['number', 'null'] },
    },
    additionalProperties: false,
  };
}

function weeklySuggestionArtifactSchema() {
  return {
    type: 'object',
    required: ['weeklyIssueId', 'items'],
    properties: {
      artifactVersion: { type: 'string', enum: ['weekly-suggestion.v1'], default: 'weekly-suggestion.v1' },
      provider: { type: 'string', enum: ['hermes', 'admin'], default: 'hermes' },
      weeklyIssueId: { type: 'integer', minimum: 1 },
      agentRunId: { type: 'string', maxLength: 160, description: 'Required when provider is hermes.' },
      sourceRunId: { type: 'string', maxLength: 160 },
      status: { type: 'string', enum: ['preview', 'empty', 'stale', 'rejected'], default: 'preview' },
      intro: { type: 'string', maxLength: 1000 },
      items: { type: 'array', maxItems: 30, items: weeklySuggestionItemSchema() },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      evidenceRefs: { type: 'array', items: evidenceRefSchema(), maxItems: 30 },
      preferenceRefs: { type: 'array', items: { type: 'string', maxLength: 160 }, maxItems: 20 },
      generatedAt: { type: 'string', format: 'date-time' },
      expiresAt: { type: 'string', format: 'date-time' },
    },
    additionalProperties: false,
  };
}

function errorResponse(description: string) {
  return {
    description,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/ErrorEnvelope' },
      },
    },
  };
}
