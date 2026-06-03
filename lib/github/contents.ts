import type { InstallationOctokit } from './app';
import { WORKFLOW_PATH, WORKFLOW_YAML } from './workflow-template';

// Idempotent writer for the Preflight workflow file.
//   absent     -> create
//   identical  -> unchanged (no commit)
//   different  -> drift  (do NOT clobber a hand-edited file; UI offers overwrite)
// Requires the GitHub App to hold BOTH Contents:write and Workflows:write — writing
// under .github/workflows/ with Contents alone returns 403/422.

export type WorkflowState = 'created' | 'updated' | 'unchanged' | 'drift';

export interface EnsureWorkflowResult {
  state: WorkflowState;
  sha: string | null;
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    (err as { status?: number }).status === 404
  );
}

export async function ensureWorkflow(
  octokit: InstallationOctokit,
  owner: string,
  repo: string,
  branch: string,
  opts: { overwrite?: boolean; yaml?: string } = {},
): Promise<EnsureWorkflowResult> {
  // Defaults to the canonical Vercel YAML; the setup flow passes a provider-specific
  // variant (see workflowYaml). Drift is compared against this same desired content,
  // so switching providers correctly reports drift on the old file.
  const desired = opts.yaml ?? WORKFLOW_YAML;
  const desiredB64 = Buffer.from(desired, 'utf8').toString('base64');

  let existingSha: string | null = null;
  let existingContent: string | null = null;
  try {
    const res = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: WORKFLOW_PATH,
      ref: branch,
    });
    const data = res.data;
    // GitHub base64-encodes file content with embedded newlines; Buffer ignores them.
    if (!Array.isArray(data) && data.type === 'file') {
      existingSha = data.sha;
      existingContent = Buffer.from(data.content, 'base64').toString('utf8');
    }
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }

  if (existingContent === null) {
    const put = await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: WORKFLOW_PATH,
      message: 'ci: add Preflight security gate workflow',
      content: desiredB64,
      branch,
    });
    return { state: 'created', sha: put.data.content?.sha ?? null };
  }

  // Tolerate trailing-whitespace-only differences so a hand-committed copy of the
  // exact YAML isn't flagged as drift.
  if (existingContent.trimEnd() === desired.trimEnd()) {
    return { state: 'unchanged', sha: existingSha };
  }

  if (!opts.overwrite) {
    return { state: 'drift', sha: existingSha };
  }

  const put = await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: WORKFLOW_PATH,
    message: 'ci: update Preflight security gate workflow',
    content: desiredB64,
    branch,
    sha: existingSha ?? undefined,
  });
  return { state: 'updated', sha: put.data.content?.sha ?? null };
}
