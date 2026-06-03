import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// Symmetric encryption for provider API tokens at rest (e.g. the Vercel token in
// vercel_connection.tokenCipher). AES-256-GCM gives both confidentiality and
// integrity, so a tampered ciphertext fails to decrypt rather than yielding garbage.
//
// The key is derived lazily from TOKEN_ENCRYPTION_KEY (preferred) or AUTH_SECRET, so
// importing this module never throws when env is absent — same fail-soft contract as
// db/index.ts and lib/stripe.ts. Encrypt/decrypt run only at request time, where the
// secret is present; a missing secret throws there, never at module load.

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

function key(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY || process.env.AUTH_SECRET;
  if (!raw) {
    throw new Error('TOKEN_ENCRYPTION_KEY or AUTH_SECRET must be set to encrypt secrets.');
  }
  // Normalize an arbitrary-length secret to a fixed 32-byte key.
  return createHash('sha256').update(raw).digest();
}

// Returns `iv.tag.ciphertext`, each segment base64url — safe to persist as text.
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

// Inverse of encryptSecret. Throws on a malformed string or a GCM tag mismatch
// (tampered/garbled value); callers treat any throw as "no usable token".
export function decryptSecret(payload: string): string {
  const parts = payload.split('.');
  if (parts.length !== 3) throw new Error('Malformed ciphertext.');
  const [ivB64, tagB64, dataB64] = parts;
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  const data = Buffer.from(dataB64, 'base64url');
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
