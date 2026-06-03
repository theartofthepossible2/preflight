'use client';

import { useState } from 'react';
import type { ConnectInstallation, ConnectRepo, RepoSetupRow } from '@/lib/github/setup-data';
import {
  attestGateAction,
  configureRepoAction,
  connectRepoAction,
  rotateRepoKeyAction,
} from './github-actions';

// The page passes a flattened, serializable view of the active gate provider so
// this client never imports the server-only gate registry.
interface GateDescriptor {
  id: string;
  label: string;
  settingsUrl: string;
  instructions: string[];
}

interface Props {
  configured: boolean;
  subscribed: boolean;
  installations: ConnectInstallation[];
  repos: ConnectRepo[];
  setups: RepoSetupRow[];
  // Default descriptor (active provider, no repo) for the optimistic path and any
  // repo without its own entry yet.
  gate: GateDescriptor;
  // Per-repo descriptors keyed by full name, each built with the repo's real context.
  gates: Record<string, GateDescriptor>;
  // Deploy-gate providers the user can pick from when configuring a repo.
  providers: { id: string; label: string }[];
}

type Chip = { label: string; cls: string };

function workflowChip(state: string): Chip {
  switch (state) {
    case 'created':
    case 'updated':
    case 'unchanged':
      return { label: 'workflow ready', cls: 'low' };
    case 'drift':
      return { label: 'workflow drifted', cls: 'medium' };
    case 'error':
      return { label: 'workflow error', cls: 'high' };
    default:
      return { label: 'workflow pending', cls: 'info' };
  }
}

function secretChip(state: string): Chip {
  switch (state) {
    case 'set':
      return { label: 'secret set', cls: 'low' };
    case 'error':
      return { label: 'secret error', cls: 'high' };
    default:
      return { label: 'secret pending', cls: 'info' };
  }
}

function gateChip(state: string): Chip {
  switch (state) {
    case 'required':
      return { label: 'gate required', cls: 'low' };
    case 'missing':
      return { label: 'gate missing', cls: 'high' };
    case 'error':
      return { label: 'gate error', cls: 'high' };
    default:
      return { label: 'gate: action needed', cls: 'medium' };
  }
}

export function ConnectManager({
  configured,
  subscribed,
  installations,
  repos,
  setups: initialSetups,
  gate,
  gates,
  providers,
}: Props) {
  const [setups, setSetups] = useState(initialSetups);
  const [selected, setSelected] = useState('');
  const [provider, setProvider] = useState(providers[0]?.id ?? gate.id);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Descriptors returned by configure for just-saved rows, so their gate instructions
  // render correctly before the next server render rebuilds `gates`.
  const [gateOverrides, setGateOverrides] = useState<Record<string, GateDescriptor>>({});

  const configuredNames = new Set(setups.map((s) => s.repoFullName));
  const available = repos.filter((r) => !configuredNames.has(r.fullName));
  const selectedName = selected.includes('::') ? selected.split('::')[1] : '';

  async function onConnect() {
    setBusy('connect');
    setError(null);
    const res = await connectRepoAction();
    if (res.error) {
      setError(res.error);
      setBusy(null);
      return;
    }
    if (res.url) window.location.href = res.url;
  }

  async function runConfigure(
    repoFullName: string,
    installationId: number,
    overwrite = false,
    gateProvider?: string,
  ) {
    setBusy(repoFullName);
    setError(null);
    const form = new FormData();
    form.append('repoFullName', repoFullName);
    form.append('installationId', String(installationId));
    if (overwrite) form.append('overwrite', 'true');
    if (gateProvider) form.append('gateProvider', gateProvider);
    const res = await configureRepoAction(form);
    setBusy(null);

    // Early failures (auth/subscription/invalid repo) carry no state — surface and stop.
    if (res.error && res.workflowState === undefined) {
      setError(res.error);
      return;
    }

    if (res.gate) {
      setGateOverrides((prev) => ({ ...prev, [repoFullName]: res.gate! }));
    }

    setSetups((prev) => {
      const existing = prev.find((s) => s.repoFullName === repoFullName);
      const rest = prev.filter((s) => s.repoFullName !== repoFullName);
      const nextProvider = res.gateProvider ?? gateProvider ?? existing?.gateProvider ?? gate.id;
      // A provider switch invalidates a prior attestation (mirrors the server reset).
      const gateState =
        existing && existing.gateProvider !== nextProvider
          ? 'unverified'
          : existing?.gateState ?? 'unverified';
      const updated: RepoSetupRow = {
        repoFullName,
        installationId,
        workflowState: res.workflowState ?? 'pending',
        secretState: res.secretState ?? 'pending',
        gateState,
        gateProvider: nextProvider,
        defaultBranch: existing?.defaultBranch ?? null,
        lastError: res.error ?? null,
        updatedAt: new Date().toISOString(),
      };
      return [updated, ...rest];
    });
    setSelected('');
  }

  async function onRotate(repoFullName: string) {
    setBusy(repoFullName);
    setError(null);
    const form = new FormData();
    form.append('repoFullName', repoFullName);
    const res = await rotateRepoKeyAction(form);
    setBusy(null);
    if (res.error) {
      setError(res.error);
      return;
    }
    setSetups((prev) =>
      prev.map((s) =>
        s.repoFullName === repoFullName
          ? { ...s, secretState: 'set', lastError: null, updatedAt: new Date().toISOString() }
          : s,
      ),
    );
  }

  async function onAttest(repoFullName: string) {
    setBusy(repoFullName);
    const form = new FormData();
    form.append('repoFullName', repoFullName);
    const res = await attestGateAction(form);
    setBusy(null);
    if (res.ok) {
      setSetups((prev) =>
        prev.map((s) => (s.repoFullName === repoFullName ? { ...s, gateState: 'required' } : s)),
      );
    }
  }

  return (
    <section className="uploader">
      <h2 style={{ marginTop: 0, fontSize: 16 }}>Connect a repository</h2>

      {!configured ? (
        <p className="hint" style={{ marginTop: 0 }}>
          One-click setup isn’t enabled on this instance yet. Use the manual steps below to add the
          workflow file and the secret yourself.
        </p>
      ) : (
        <>
          <p className="hint" style={{ marginTop: 0 }}>
            Connect once and Preflight writes the workflow file and the{' '}
            <code>PREFLIGHT_API_KEY</code> secret for you. Scans still run entirely in your own CI —
            Preflight never gets your source at runtime.
          </p>

          {installations.length > 0 && (
            <div className="summary" style={{ marginTop: 12 }}>
              {installations.map((i) => (
                <span key={i.installationId} className={`chip ${i.suspended ? 'medium' : 'low'}`}>
                  {i.accountLogin}
                  {i.suspended ? ' (suspended)' : ''}
                </span>
              ))}
            </div>
          )}

          <div className="row" style={{ marginTop: 12 }}>
            <button type="button" onClick={onConnect} disabled={busy === 'connect'}>
              {installations.length > 0 ? 'Add or manage repositories' : 'Connect GitHub'}
            </button>
          </div>

          {!subscribed && (
            <p className="hint">An active subscription is required to configure a repository.</p>
          )}

          {available.length > 0 && (
            <div className="row" style={{ marginTop: 12 }}>
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                disabled={!subscribed || busy !== null}
                style={{
                  flex: '1 1 auto',
                  padding: '8px 10px',
                  font: 'inherit',
                  background: 'var(--panel-2)',
                  color: 'var(--text)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                }}
              >
                <option value="">Choose a repository to protect…</option>
                {available.map((r) => (
                  <option
                    key={`${r.installationId}:${r.fullName}`}
                    value={`${r.installationId}::${r.fullName}`}
                  >
                    {r.fullName}
                    {r.private ? ' (private)' : ''}
                  </option>
                ))}
              </select>
              <select
                aria-label="Deploy platform"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                disabled={!subscribed || busy !== null}
                style={{
                  padding: '8px 10px',
                  font: 'inherit',
                  background: 'var(--panel-2)',
                  color: 'var(--text)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                }}
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!subscribed || !selected || busy !== null}
                onClick={() => {
                  const [inst, name] = selected.split('::');
                  runConfigure(name, Number(inst), false, provider);
                }}
              >
                {busy !== null && busy === selectedName ? 'Configuring…' : 'Configure'}
              </button>
            </div>
          )}

          {error && <div className="error">{error}</div>}

          <ul style={{ listStyle: 'none', padding: 0, margin: '16px 0 0' }}>
            {setups.length === 0 && <li className="hint">No repositories connected yet.</li>}
            {setups.map((s) => {
              const wf = workflowChip(s.workflowState);
              const sec = secretChip(s.secretState);
              const g = gateChip(s.gateState);
              // Prefer a descriptor returned by a just-run configure, then the server's
              // per-repo map, then the default — so the gate block always matches the
              // row's provider, even right after an optimistic update.
              const sg = gateOverrides[s.repoFullName] ?? gates[s.repoFullName] ?? gate;
              const isBusy = busy === s.repoFullName;
              return (
                <li key={s.repoFullName} className="finding" style={{ marginTop: 8 }}>
                  <div className="top">
                    <h3>{s.repoFullName}</h3>
                  </div>
                  <div className="summary" style={{ marginTop: 8 }}>
                    <span className={`chip ${wf.cls}`}>{wf.label}</span>
                    <span className={`chip ${sec.cls}`}>{sec.label}</span>
                    <span className={`chip ${g.cls}`}>{g.label}</span>
                  </div>

                  {s.lastError && (
                    <p className="hint" style={{ color: 'var(--high)' }}>
                      {s.lastError}
                    </p>
                  )}

                  <div className="row" style={{ marginTop: 10 }}>
                    <button
                      type="button"
                      disabled={!subscribed || isBusy}
                      onClick={() => runConfigure(s.repoFullName, s.installationId, false, s.gateProvider)}
                    >
                      {isBusy ? 'Working…' : 'Re-run setup'}
                    </button>
                    {s.workflowState === 'drift' && (
                      <button
                        type="button"
                        disabled={!subscribed || isBusy}
                        onClick={() => runConfigure(s.repoFullName, s.installationId, true, s.gateProvider)}
                      >
                        Overwrite workflow
                      </button>
                    )}
                    {s.secretState === 'set' && (
                      <button
                        type="button"
                        disabled={!subscribed || isBusy}
                        onClick={() => onRotate(s.repoFullName)}
                      >
                        {isBusy ? 'Working…' : 'Rotate key'}
                      </button>
                    )}
                  </div>

                  {s.gateState !== 'required' && (
                    <div className="body">
                      <h4>Require the {sg.label} check</h4>
                      <ol>
                        {sg.instructions.map((step, idx) => (
                          <li key={idx}>{step}</li>
                        ))}
                      </ol>
                      <div className="row" style={{ marginTop: 8 }}>
                        <a
                          className="chip"
                          style={{ color: 'var(--accent)', textDecoration: 'none' }}
                          href={sg.settingsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open {sg.label} ↗
                        </a>
                        <button type="button" disabled={isBusy} onClick={() => onAttest(s.repoFullName)}>
                          I&apos;ve required it
                        </button>
                      </div>
                      <p className="hint" style={{ marginTop: 8 }}>
                        We can&apos;t confirm this automatically yet, so this is your own
                        record that the check is required.
                      </p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
