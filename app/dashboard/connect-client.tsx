'use client';

import { useState } from 'react';
import type { ConnectInstallation, ConnectRepo, RepoSetupRow } from '@/lib/github/setup-data';
import { attestGateAction, configureRepoAction, connectRepoAction } from './github-actions';

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
  gate: GateDescriptor;
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
}: Props) {
  const [setups, setSetups] = useState(initialSetups);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  async function runConfigure(repoFullName: string, installationId: number, overwrite = false) {
    setBusy(repoFullName);
    setError(null);
    const form = new FormData();
    form.append('repoFullName', repoFullName);
    form.append('installationId', String(installationId));
    if (overwrite) form.append('overwrite', 'true');
    const res = await configureRepoAction(form);
    setBusy(null);

    // Early failures (auth/subscription/invalid repo) carry no state — surface and stop.
    if (res.error && res.workflowState === undefined) {
      setError(res.error);
      return;
    }

    setSetups((prev) => {
      const existing = prev.find((s) => s.repoFullName === repoFullName);
      const rest = prev.filter((s) => s.repoFullName !== repoFullName);
      const updated: RepoSetupRow = {
        repoFullName,
        installationId,
        workflowState: res.workflowState ?? 'pending',
        secretState: res.secretState ?? 'pending',
        gateState: existing?.gateState ?? 'unverified',
        gateProvider: existing?.gateProvider ?? gate.id,
        defaultBranch: existing?.defaultBranch ?? null,
        lastError: res.error ?? null,
        updatedAt: new Date().toISOString(),
      };
      return [updated, ...rest];
    });
    setSelected('');
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
              <button
                type="button"
                disabled={!subscribed || !selected || busy !== null}
                onClick={() => {
                  const [inst, name] = selected.split('::');
                  runConfigure(name, Number(inst));
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
                      onClick={() => runConfigure(s.repoFullName, s.installationId)}
                    >
                      {isBusy ? 'Working…' : 'Re-run setup'}
                    </button>
                    {s.workflowState === 'drift' && (
                      <button
                        type="button"
                        disabled={!subscribed || isBusy}
                        onClick={() => runConfigure(s.repoFullName, s.installationId, true)}
                      >
                        Overwrite workflow
                      </button>
                    )}
                  </div>

                  {s.gateState !== 'required' && (
                    <div className="body">
                      <h4>Require the {gate.label} check</h4>
                      <ol>
                        {gate.instructions.map((step, idx) => (
                          <li key={idx}>{step}</li>
                        ))}
                      </ol>
                      <div className="row" style={{ marginTop: 8 }}>
                        <a
                          className="chip"
                          style={{ color: 'var(--accent)', textDecoration: 'none' }}
                          href={gate.settingsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open {gate.label} ↗
                        </a>
                        <button type="button" disabled={isBusy} onClick={() => onAttest(s.repoFullName)}>
                          Mark as required
                        </button>
                      </div>
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
