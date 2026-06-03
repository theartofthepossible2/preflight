import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { vercelConnections } from '@/db/schema';
import { decryptSecret } from '@/lib/crypto';

// Server-only access to a user's stored Vercel connection. Splitting the two reads
// keeps the decrypted token off any path that only needs identifiers (settingsUrl).

export interface VercelConnection {
  token: string;
  teamId: string | null;
  projectId: string | null;
}

export interface VercelConnectionMeta {
  teamId: string | null;
  projectId: string | null;
}

// Full connection including the decrypted token — request-time only. Returns null when
// the user hasn't connected Vercel, the table is absent (migration not applied), or the
// token can't be decrypted. Any failure degrades to "no usable connection", never an
// error the user sees.
export async function resolveVercelConnection(userId: string): Promise<VercelConnection | null> {
  try {
    const [row] = await db
      .select()
      .from(vercelConnections)
      .where(eq(vercelConnections.userId, userId))
      .limit(1);
    if (!row) return null;
    return { token: decryptSecret(row.tokenCipher), teamId: row.teamId, projectId: row.projectId };
  } catch {
    return null;
  }
}

// Non-secret identifiers only — never decrypts the token. Lets callers decide whether a
// connection exists (and scope a deep link) without touching the secret.
export async function getVercelConnectionMeta(userId: string): Promise<VercelConnectionMeta | null> {
  try {
    const [row] = await db
      .select({ teamId: vercelConnections.teamId, projectId: vercelConnections.projectId })
      .from(vercelConnections)
      .where(eq(vercelConnections.userId, userId))
      .limit(1);
    return row ?? null;
  } catch {
    return null;
  }
}
