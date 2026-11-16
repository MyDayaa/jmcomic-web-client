import { useSyncExternalStore } from 'react';

type State = { favorite?: boolean; liked?: boolean; updatedAt?: number };
const CHANGE = 'jm-engagement-change';
const volatile = new Map<string, string>();
const key = (uid: string) => `jm-album-state:v1:${uid}`;
function raw(uid: string) {
  if (volatile.has(uid)) return volatile.get(uid)!;
  try { return localStorage.getItem(key(uid)) ?? '{}'; } catch { return '{}'; }
}
function parse(value: string): Record<string, State> {
  try {
    const data = JSON.parse(value);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch { return {}; }
}
function subscribe(listener: () => void) {
  const onStorage = () => { volatile.clear(); listener(); };
  window.addEventListener(CHANGE, listener);
  window.addEventListener('storage', onStorage);
  return () => { window.removeEventListener(CHANGE, listener); window.removeEventListener('storage', onStorage); };
}
export function rememberEngagement(uid: string, albumId: string, update: State) {
  if (!uid || !/^\d+$/.test(albumId)) return;
  const data = parse(raw(uid));
  data[albumId] = { ...data[albumId], ...update, updatedAt: Date.now() };
  const entries = Object.entries(data).sort((a, b) => (b[1]?.updatedAt ?? 0) - (a[1]?.updatedAt ?? 0)).slice(0, 500);
  const encoded = JSON.stringify(Object.fromEntries(entries));
  try { localStorage.setItem(key(uid), encoded); volatile.delete(uid); } catch { volatile.set(uid, encoded); }
  window.dispatchEvent(new Event(CHANGE));
}
/** A cached list must not undo a newer, confirmed button action on reopening. */
export function seedEngagement(uid: string, albumId: string, update: State) {
  const known = parse(raw(uid))[albumId];
  rememberEngagement(uid, albumId, {
    ...update,
    ...(typeof known?.favorite === 'boolean' ? { favorite: known.favorite } : {}),
    ...(typeof known?.liked === 'boolean' ? { liked: known.liked } : {}),
  });
}
export function useEngagement(uid: string, albumId: string) {
  const data = parse(useSyncExternalStore(subscribe, () => raw(uid), () => '{}'));
  const saved = data[albumId];
  return { favorite: typeof saved?.favorite === 'boolean' ? saved.favorite : undefined, liked: saved?.liked === true };
}
