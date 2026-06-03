import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { AdapterAccountType } from 'next-auth/adapters';

// ---------- Auth.js standard tables ----------

export const users = pgTable('user', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name'),
  email: text('email').notNull(),
  emailVerified: timestamp('emailVerified', { mode: 'date' }),
  image: text('image'),
});

export const accounts = pgTable(
  'account',
  {
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').$type<AdapterAccountType>().notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('providerAccountId').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (account) => ({
    compoundKey: primaryKey({ columns: [account.provider, account.providerAccountId] }),
  }),
);

export const sessions = pgTable('session', {
  sessionToken: text('sessionToken').primaryKey(),
  userId: text('userId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date' }).notNull(),
});

export const verificationTokens = pgTable(
  'verificationToken',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { mode: 'date' }).notNull(),
  },
  (vt) => ({ compoundKey: primaryKey({ columns: [vt.identifier, vt.token] }) }),
);

// ---------- Preflight product tables ----------

export const subscriptions = pgTable(
  'subscription',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    stripeCustomerId: text('stripeCustomerId').notNull(),
    stripeSubscriptionId: text('stripeSubscriptionId'),
    stripePriceId: text('stripePriceId'),
    status: text('status').notNull(),
    currentPeriodEnd: timestamp('currentPeriodEnd', { mode: 'date' }),
    createdAt: timestamp('createdAt', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: uniqueIndex('subscription_user_idx').on(t.userId),
    customerIdx: uniqueIndex('subscription_customer_idx').on(t.stripeCustomerId),
  }),
);

export const apiKeys = pgTable(
  'api_key',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    keyHash: text('keyHash').notNull(),
    keyPrefix: text('keyPrefix').notNull(),
    createdAt: timestamp('createdAt', { mode: 'date' }).notNull().defaultNow(),
    lastUsedAt: timestamp('lastUsedAt', { mode: 'date' }),
    revokedAt: timestamp('revokedAt', { mode: 'date' }),
  },
  (t) => ({
    hashIdx: uniqueIndex('api_key_hash_idx').on(t.keyHash),
    userIdx: index('api_key_user_idx').on(t.userId),
  }),
);

export const scans = pgTable(
  'scan',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    apiKeyId: text('apiKeyId').references(() => apiKeys.id, { onDelete: 'set null' }),
    repo: text('repo'),
    ref: text('ref'),
    commitSha: text('commitSha'),
    findingsCount: integer('findingsCount').notNull().default(0),
    highCount: integer('highCount').notNull().default(0),
    aiEnriched: boolean('aiEnriched').notNull().default(false),
    findings: jsonb('findings').notNull(),
    additionalObservations: jsonb('additionalObservations'),
    createdAt: timestamp('createdAt', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('scan_user_idx').on(t.userId),
    createdIdx: index('scan_created_idx').on(t.createdAt),
  }),
);

// Content-hash cache: avoids re-billing for unchanged flagged code.
// cacheKey = sha256(finding.id + codeSnippet + detail) — see lib/cache.ts.
export const analysisCache = pgTable(
  'analysis_cache',
  {
    cacheKey: text('cacheKey').primaryKey(),
    analysis: jsonb('analysis').notNull(),
    model: text('model').notNull(),
    createdAt: timestamp('createdAt', { mode: 'date' }).notNull().defaultNow(),
    hitCount: integer('hitCount').notNull().default(0),
  },
);

// ---------- Automated repo setup (GitHub App) ----------

// One row per GitHub App installation a user connects. The installation is the
// scoped, revocable grant that lets the backend write the workflow file + secret.
export const githubInstallations = pgTable(
  'github_installation',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    // GitHub's numeric installation id (stable per install).
    installationId: integer('installationId').notNull(),
    accountLogin: text('accountLogin').notNull(),
    // 'User' | 'Organization'.
    accountType: text('accountType').notNull(),
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Set while an org install awaits owner approval, or when GitHub suspends it.
    suspendedAt: timestamp('suspendedAt', { mode: 'date' }),
    createdAt: timestamp('createdAt', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => ({
    installationIdx: uniqueIndex('github_installation_installation_idx').on(t.installationId),
    userIdx: index('github_installation_user_idx').on(t.userId),
  }),
);

// One row per repo a user has run automated setup against. gateProvider/gateState
// exist from day one so additional deploy-gate adapters need no migration.
export const repoSetups = pgTable(
  'repo_setup',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    installationId: integer('installationId').notNull(),
    // 'owner/name'.
    repoFullName: text('repoFullName').notNull(),
    // GitHub numeric repo id — survives renames.
    repoId: integer('repoId'),
    defaultBranch: text('defaultBranch'),
    // pending | created | updated | unchanged | drift | error
    workflowState: text('workflowState').notNull().default('pending'),
    workflowSha: text('workflowSha'),
    // pending | set | error
    secretState: text('secretState').notNull().default('pending'),
    apiKeyId: text('apiKeyId').references(() => apiKeys.id, { onDelete: 'set null' }),
    gateProvider: text('gateProvider').notNull().default('vercel'),
    // unverified | required | missing | error
    gateState: text('gateState').notNull().default('unverified'),
    gateLastCheckedAt: timestamp('gateLastCheckedAt', { mode: 'date' }),
    lastError: text('lastError'),
    createdAt: timestamp('createdAt', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => ({
    userRepoIdx: uniqueIndex('repo_setup_user_repo_idx').on(t.userId, t.repoFullName),
    userIdx: index('repo_setup_user_idx').on(t.userId),
  }),
);

// ---------- Abuse prevention ----------

// Durable fixed-window rate-limit counters, shared across serverless instances.
// bucketKey = `${subjectKey}:${windowIndex}` where windowIndex = floor(now / WINDOW_MS),
// so each key gets one row per window. An atomic upsert increments `count`; expired
// rows are swept opportunistically (the expiresAt index keeps that delete cheap).
// The limiter fails open — losing this table only removes throttling, never blocks
// a legitimate request. See lib/rateLimit.ts.
export const rateLimits = pgTable(
  'rate_limit',
  {
    bucketKey: text('bucketKey').primaryKey(),
    count: integer('count').notNull().default(0),
    expiresAt: timestamp('expiresAt', { mode: 'date' }).notNull(),
  },
  (t) => ({
    expiresIdx: index('rate_limit_expires_idx').on(t.expiresAt),
  }),
);

// ---------- Billing webhook idempotency ----------

// One row per Stripe event id we've durably handled. Stripe delivers events at
// least once, so the webhook can see the same event id more than once. The handler
// claims the id (insert ... on conflict do nothing) before processing and skips any
// event already present; a handler failure releases the claim so Stripe's retry can
// re-run it. See app/api/stripe/webhook/route.ts.
export const stripeEvents = pgTable('stripe_event', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  receivedAt: timestamp('receivedAt', { mode: 'date' }).notNull().defaultNow(),
});

// ---------- Deploy-gate provider connections ----------

// One row per user who has connected a Vercel API token so the gate can be verified
// against Vercel's API. The raw token is NEVER stored — only its AES-256-GCM
// ciphertext (see lib/crypto.ts). teamId/projectId are non-secret identifiers used to
// scope API calls and build deep links. Reused-by-design: Netlify/Cloudflare adapters
// (Workstream B) get their own connection tables following this shape.
export const vercelConnections = pgTable(
  'vercel_connection',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // AES-256-GCM ciphertext (iv.tag.ciphertext, base64url) of the Vercel API token.
    tokenCipher: text('tokenCipher').notNull(),
    // Vercel team id (null for a personal account) and the project the gate applies to.
    teamId: text('teamId'),
    projectId: text('projectId'),
    createdAt: timestamp('createdAt', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: uniqueIndex('vercel_connection_user_idx').on(t.userId),
  }),
);
