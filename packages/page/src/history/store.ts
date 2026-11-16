import { useSyncExternalStore } from 'react';

export const SEARCH_HISTORY_KEY = 'jm-search-history:v1';
export const READING_HISTORY_KEY = 'jm-reading-history:v1';
const CHANGE = 'jm-local-history-change';

export type SearchHistoryEntry = {
  query: string; category: string; order: string; time: string; updatedAt: number;
};
export type ReadingHistoryEntry = {
  albumId: string; chapterId: string; title: string; chapterName: string;
  page: number; totalPages: number; updatedAt: number;
};

function readRaw(key: string): string {
  try { return localStorage.getItem(key) ?? '[]'; } catch { return '[]'; }
}

function list<T>(raw: string, valid: (value: T) => boolean): T[] {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter(item => item && valid(item)) : [];
  } catch { return []; }
}

function save(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Optional local history. */ }
  window.dispatchEvent(new Event(CHANGE));
}

function subscribe(listener: () => void) {
  window.addEventListener(CHANGE, listener);
  window.addEventListener('storage', listener);
  return () => { window.removeEventListener(CHANGE, listener); window.removeEventListener('storage', listener); };
}

const validSearch = (item: SearchHistoryEntry) => typeof item.query === 'string' && !!item.query.trim()
  && typeof item.category === 'string' && typeof item.order === 'string' && typeof item.time === 'string' && Number.isFinite(item.updatedAt);
const validReading = (item: ReadingHistoryEntry) => /^\d{1,16}$/.test(item.albumId) && /^\d{1,16}$/.test(item.chapterId)
  && typeof item.title === 'string' && typeof item.chapterName === 'string'
  && Number.isInteger(item.page) && Number.isInteger(item.totalPages) && item.page >= 0 && item.page < item.totalPages && Number.isFinite(item.updatedAt);

export function searchHistoryId(item: Pick<SearchHistoryEntry, 'query' | 'category' | 'order' | 'time'>) {
  return JSON.stringify([item.query.normalize('NFKC').toLowerCase(), item.category, item.order, item.time]);
}
export function getSearchHistory() { return list<SearchHistoryEntry>(readRaw(SEARCH_HISTORY_KEY), validSearch).slice(0, 30); }
export function getReadingHistory() { return list<ReadingHistoryEntry>(readRaw(READING_HISTORY_KEY), validReading).slice(0, 200); }
export function useSearchHistory() {
  return list<SearchHistoryEntry>(useSyncExternalStore(subscribe, () => readRaw(SEARCH_HISTORY_KEY), () => '[]'), validSearch).slice(0, 30);
}
export function useReadingHistory() {
  return list<ReadingHistoryEntry>(useSyncExternalStore(subscribe, () => readRaw(READING_HISTORY_KEY), () => '[]'), validReading).slice(0, 200);
}
export function rememberSearch(entry: Omit<SearchHistoryEntry, 'updatedAt'>, now = Date.now()) {
  const next = { ...entry, query: entry.query.trim().slice(0, 500), updatedAt: now };
  if (!validSearch(next)) return;
  const id = searchHistoryId(next);
  save(SEARCH_HISTORY_KEY, [next, ...getSearchHistory().filter(item => searchHistoryId(item) !== id)].slice(0, 30));
}
export function rememberReading(entry: Omit<ReadingHistoryEntry, 'updatedAt'>, now = Date.now()) {
  importReadingProgress();
  const next = { ...entry, title: entry.title.slice(0, 300), chapterName: entry.chapterName.slice(0, 200), updatedAt: now };
  if (!validReading(next)) return;
  const previous = getReadingHistory();
  const first = previous[0];
  if (first && now - first.updatedAt < 30_000 && Object.keys(entry).every(key => first[key as keyof typeof entry] === next[key as keyof typeof entry])) return;
  save(READING_HISTORY_KEY, [next, ...previous.filter(item => item.albumId !== next.albumId)].slice(0, 200));
}
export function removeSearchHistory(id: string) { save(SEARCH_HISTORY_KEY, getSearchHistory().filter(item => searchHistoryId(item) !== id)); }
export function removeReadingHistory(albumId: string) { save(READING_HISTORY_KEY, getReadingHistory().filter(item => item.albumId !== albumId)); }
export function clearSearchHistory() { save(SEARCH_HISTORY_KEY, []); }
export function clearReadingHistory() { save(READING_HISTORY_KEY, []); }
export function searchHistoryUrl(entry: SearchHistoryEntry) {
  return `/?${new URLSearchParams({ q: entry.query, cat: entry.category, order: entry.order, time: entry.time, page: '1' })}`;
}

/** Recover existing progress once; clearing/deleting history never imports it again. */
export function importReadingProgress() {
  try {
    if (localStorage.getItem(READING_HISTORY_KEY) !== null) return;
    const entries: ReadingHistoryEntry[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith('reading-progress:')) continue;
      try {
        const progress = JSON.parse(localStorage.getItem(key) ?? '');
        if (progress.albumId === '0') progress.albumId = progress.chapterId;
        const cached = JSON.parse(localStorage.getItem(`reader-album-cache:${progress.albumId}`) ?? 'null');
        const entry = { ...progress, title: cached?.album?.name ?? `作品 ${progress.albumId}`, chapterName: '' };
        if (validReading(entry)) entries.push(entry);
      } catch { /* Skip an unreadable legacy entry. */ }
    }
    const unique = new Map<string, ReadingHistoryEntry>();
    for (const entry of entries.sort((a, b) => b.updatedAt - a.updatedAt)) if (!unique.has(entry.albumId)) unique.set(entry.albumId, entry);
    save(READING_HISTORY_KEY, [...unique.values()].slice(0, 200));
  } catch { /* Storage may be disabled. */ }
}
