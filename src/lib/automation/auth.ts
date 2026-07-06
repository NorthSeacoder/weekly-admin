import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';

export const AUTOMATION_TOKEN_PREFIX = 'wa_';

export type AutomationScope =
  | 'sync:run'
  | 'score:run'
  | 'content:resync'
  | 'weekly:read'
  | 'weekly:suggest'
  | 'weekly:publish'
  | 'ops:read';

export type AutomationCaller = {
  tokenId: number;
  name: string;
  callerType: string;
  tokenPrefix: string;
  scopes: AutomationScope[];
};

export type AutomationAuthErrorCode =
  | 'AUTOMATION_TOKEN_MISSING'
  | 'AUTOMATION_TOKEN_INVALID'
  | 'AUTOMATION_TOKEN_INACTIVE'
  | 'AUTOMATION_TOKEN_EXPIRED'
  | 'AUTOMATION_SCOPE_FORBIDDEN';

export class AutomationAuthError extends Error {
  constructor(
    public readonly code: AutomationAuthErrorCode,
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'AutomationAuthError';
  }
}

export function hashAutomationToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export function getAutomationTokenPrefix(token: string): string {
  return token.slice(0, 16);
}

export function generateAutomationToken(): { token: string; tokenHash: string; tokenPrefix: string } {
  const token = `${AUTOMATION_TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
  return {
    token,
    tokenHash: hashAutomationToken(token),
    tokenPrefix: getAutomationTokenPrefix(token),
  };
}

export function extractBearerToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.substring('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

function parseScopes(value: unknown): AutomationScope[] {
  if (!Array.isArray(value)) return [];
  return value.filter((scope): scope is AutomationScope => typeof scope === 'string') as AutomationScope[];
}

function assertScope(scopes: AutomationScope[], requiredScope?: AutomationScope) {
  if (!requiredScope) return;
  if (!scopes.includes(requiredScope)) {
    throw new AutomationAuthError('AUTOMATION_SCOPE_FORBIDDEN', 'Automation token scope is not allowed', 403);
  }
}

export async function authenticateAutomationRequest(
  request: NextRequest,
  requiredScope?: AutomationScope
): Promise<AutomationCaller> {
  const token = extractBearerToken(request);
  if (!token) {
    throw new AutomationAuthError('AUTOMATION_TOKEN_MISSING', 'Automation token is required', 401);
  }

  return authenticateAutomationTokenValue(token, requiredScope);
}

export async function authenticateAutomationTokenValue(
  token: string,
  requiredScope?: AutomationScope
): Promise<AutomationCaller> {
  if (!token.trim()) {
    throw new AutomationAuthError('AUTOMATION_TOKEN_MISSING', 'Automation token is required', 401);
  }

  const tokenHash = hashAutomationToken(token);
  const record = await prisma.automation_tokens.findUnique({
    where: { token_hash: tokenHash },
  });

  if (!record) {
    throw new AutomationAuthError('AUTOMATION_TOKEN_INVALID', 'Automation token is invalid', 401);
  }

  if (record.status !== 'active' || record.revoked_at) {
    throw new AutomationAuthError('AUTOMATION_TOKEN_INACTIVE', 'Automation token is not active', 401);
  }

  if (record.expires_at && record.expires_at.getTime() <= Date.now()) {
    throw new AutomationAuthError('AUTOMATION_TOKEN_EXPIRED', 'Automation token has expired', 401);
  }

  const scopes = parseScopes(record.scopes);
  assertScope(scopes, requiredScope);

  void prisma.automation_tokens
    .update({
      where: { id: record.id },
      data: { last_used_at: new Date() },
    })
    .catch((error) => {
      console.error('[automation-auth] Failed to update last_used_at:', error);
    });

  return {
    tokenId: record.id,
    name: record.name,
    callerType: record.caller_type,
    tokenPrefix: record.token_prefix,
    scopes,
  };
}
