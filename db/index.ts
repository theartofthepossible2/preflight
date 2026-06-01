import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is not configured.');
}

// Supabase pooler (port 6543, transaction mode) does not support prepared statements,
// so we disable them. Safe to leave off for direct (5432) connections too.
const client = postgres(databaseUrl, { prepare: false });

export const db = drizzle(client, { schema });
export { schema };
export type DB = typeof db;
