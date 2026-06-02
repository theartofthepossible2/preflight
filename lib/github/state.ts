import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Signed, expiring state carried through the GitHub App install redirect so the
// callback can recover which user started the flow without trusting a query param.
// Reuses AUTH_SECRET (already required for Auth.js). This is one half of the
// anti-spoofing defense; the other is OAuth ownership verification in the callback.

const TTL_MS = 10 * 60 * 1000; // 10 minutes

interface StatePayload {
  uid: string;
  exp: number; // epoch ms
  nonce: string;
}

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('AUTH_SECRET is not set.');
  return s;
}

function sign(body: string): string {
  return createHmac('sha256', secret()).update(body).digest('base64url');
}

export function signConnectState(uid: string): string {
  const payload: StatePayload = { uid, exp: Date.now() + TTL_MS, nonce: randomBytes(8).toString('hex') };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

// Returns the userId the state was signed for, or null if invalid/expired/tampered.
export function verifyConnectState(state: string | null | undefined): string | null {
  if (!state) return null;
  const dot = state.indexOf('.');
  if (dot <= 0) return null;
  const body = state.slice(0, dot);
  const sig = state.slice(dot + 1);

  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StatePayload;
  } catch {
    return null;
  }
  if (typeof payload.uid !== 'string' || typeof payload.exp !== 'number') return null;
  if (Date.now() > payload.exp) return null;
  return payload.uid;
}
