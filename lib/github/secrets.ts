import _sodium from 'libsodium-wrappers';
import type { InstallationOctokit } from './app';

// Writes an Actions repo secret. GitHub requires the value be encrypted client-side
// with the repo's public key using libsodium's sealed box (crypto_box_seal) — a
// plaintext value is never sent. `tweetsodium` is deprecated; do not use it.

export async function setRepoSecret(
  octokit: InstallationOctokit,
  owner: string,
  repo: string,
  name: string,
  plaintext: string,
): Promise<void> {
  const { data: publicKey } = await octokit.rest.actions.getRepoPublicKey({ owner, repo });

  await _sodium.ready;
  const sodium = _sodium;
  const binKey = sodium.from_base64(publicKey.key, sodium.base64_variants.ORIGINAL);
  const binSecret = sodium.from_string(plaintext);
  const encrypted = sodium.crypto_box_seal(binSecret, binKey);
  const encryptedValue = sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);

  await octokit.rest.actions.createOrUpdateRepoSecret({
    owner,
    repo,
    secret_name: name,
    encrypted_value: encryptedValue,
    key_id: publicKey.key_id,
  });
}
