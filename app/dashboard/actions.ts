'use server';

import { revalidatePath } from 'next/cache';
import { auth, signOut } from '@/auth';
import { issueKey, revokeKey, type IssuedKey } from '@/lib/apiKey';

export async function createKeyAction(formData: FormData): Promise<IssuedKey | { error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: 'Not signed in.' };
  const name = String(formData.get('name') ?? '').trim() || 'default';
  const key = await issueKey(session.user.id, name);
  revalidatePath('/dashboard');
  return key;
}

export async function revokeKeyAction(formData: FormData): Promise<{ ok: boolean }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false };
  const id = String(formData.get('id') ?? '');
  if (!id) return { ok: false };
  const ok = await revokeKey(session.user.id, id);
  revalidatePath('/dashboard');
  return { ok };
}

export async function signOutAction() {
  await signOut({ redirectTo: '/' });
}
