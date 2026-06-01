import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { apiKeys } from '@/db/schema';

const PREFIX = 'pflt_';

export interface IssuedKey {
  id: string;
  token: string;
  keyPrefix: string;
  name: string;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function issueKey(userId: string, name: string): Promise<IssuedKey> {
  const raw = randomBytes(32).toString('base64url');
  const token = `${PREFIX}${raw}`;
  const keyHash = hashToken(token);
  const keyPrefix = token.slice(0, PREFIX.length + 8);

  const [row] = await db
    .insert(apiKeys)
    .values({ userId, name, keyHash, keyPrefix })
    .returning({ id: apiKeys.id });

  return { id: row.id, token, keyPrefix, name };
}

export async function listKeys(userId: string) {
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .orderBy(desc(apiKeys.createdAt));
}

export async function revokeKey(userId: string, id: string): Promise<boolean> {
  const result = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id });
  return result.length > 0;
}

export interface AuthenticatedKey {
  apiKeyId: string;
  userId: string;
}

export async function authenticateBearer(authHeader: string | null): Promise<AuthenticatedKey | null> {
  if (!authHeader) return null;
  const match = /^Bearer\s+(\S+)$/.exec(authHeader);
  if (!match) return null;
  const token = match[1];
  if (!token.startsWith(PREFIX)) return null;

  const keyHash = hashToken(token);
  const rows = await db
    .select({ id: apiKeys.id, userId: apiKeys.userId, revokedAt: apiKeys.revokedAt })
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, keyHash))
    .limit(1);

  const row = rows[0];
  if (!row || row.revokedAt) return null;

  // Best-effort last_used_at update; do not block on it.
  void db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));

  return { apiKeyId: row.id, userId: row.userId };
}
