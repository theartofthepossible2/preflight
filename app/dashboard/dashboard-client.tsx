'use client';

import { useState } from 'react';
import { createKeyAction, revokeKeyAction } from './actions';

interface KeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export function ApiKeyManager({ initialKeys }: { initialKeys: KeyRow[] }) {
  const [keys, setKeys] = useState(initialKeys);
  const [name, setName] = useState('');
  const [issued, setIssued] = useState<{ token: string; keyPrefix: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append('name', name || 'default');
    const result = await createKeyAction(form);
    setBusy(false);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setIssued({ token: result.token, keyPrefix: result.keyPrefix });
    setKeys((prev) => [
      {
        id: result.id,
        name: result.name,
        keyPrefix: result.keyPrefix,
        createdAt: new Date(),
        lastUsedAt: null,
        revokedAt: null,
      },
      ...prev,
    ]);
    setName('');
  }

  async function onRevoke(id: string) {
    setBusy(true);
    const form = new FormData();
    form.append('id', id);
    const result = await revokeKeyAction(form);
    setBusy(false);
    if (result.ok) {
      setKeys((prev) => prev.map((k) => (k.id === id ? { ...k, revokedAt: new Date() } : k)));
    }
  }

  return (
    <section className="uploader">
      <h2 style={{ marginTop: 0, fontSize: 16 }}>API keys</h2>
      <form onSubmit={onCreate} className="row" style={{ gap: 8 }}>
        <input
          type="text"
          placeholder="Key name (e.g. acme-prod)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
        />
        <button type="submit" disabled={busy}>
          Create key
        </button>
      </form>
      {error && <div className="error">{error}</div>}

      {issued && (
        <div
          className="notice warn"
          style={{ marginTop: 12, padding: 12, border: '1px solid var(--medium)', borderRadius: 8 }}
        >
          <strong>Copy this now — it won&apos;t be shown again.</strong>
          <pre style={{ marginTop: 8 }}>{issued.token}</pre>
          <p className="hint" style={{ marginTop: 8 }}>
            Save as the <code>PREFLIGHT_API_KEY</code> secret in your GitHub repo
            (Settings → Secrets and variables → Actions).
          </p>
        </div>
      )}

      <ul style={{ listStyle: 'none', padding: 0, margin: '16px 0 0' }}>
        {keys.length === 0 && <li className="hint">No API keys yet.</li>}
        {keys.map((k) => (
          <li
            key={k.id}
            className="finding"
            style={{ marginTop: 8, opacity: k.revokedAt ? 0.5 : 1 }}
          >
            <div className="top">
              <h3>{k.name}</h3>
              <span className="conf">
                <code>{k.keyPrefix}…</code>
              </span>
              <span className="conf">{k.revokedAt ? 'revoked' : 'active'}</span>
            </div>
            <div className="meta">
              Created {new Date(k.createdAt).toLocaleString()}
              {k.lastUsedAt && ` · last used ${new Date(k.lastUsedAt).toLocaleString()}`}
            </div>
            {!k.revokedAt && (
              <div className="row" style={{ marginTop: 8 }}>
                <button type="button" onClick={() => onRevoke(k.id)} disabled={busy}>
                  Revoke
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function BillingButtons({ subscribed }: { subscribed: boolean }) {
  const [busy, setBusy] = useState(false);

  async function go(endpoint: string) {
    setBusy(true);
    try {
      const res = await fetch(endpoint, { method: 'POST' });
      const body = await res.json();
      if (body.url) window.location.href = body.url;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="row">
      {subscribed ? (
        <button type="button" onClick={() => go('/api/stripe/portal')} disabled={busy}>
          Manage billing
        </button>
      ) : (
        <button type="button" onClick={() => go('/api/stripe/checkout')} disabled={busy}>
          Subscribe — $29/mo
        </button>
      )}
    </div>
  );
}
