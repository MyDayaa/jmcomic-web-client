import assert from 'node:assert/strict';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, test, vi } from 'vitest';
import HistoryPage from '../src/history';
import { SearchHistory } from '../src/history/SearchHistory';
import {
  SEARCH_HISTORY_KEY, READING_HISTORY_KEY, clearReadingHistory, clearSearchHistory,
  getReadingHistory, getSearchHistory, importReadingProgress, rememberReading, rememberSearch,
  removeReadingHistory, removeSearchHistory, searchHistoryId, searchHistoryUrl,
} from '../src/history/store';

const query = { query: '+Blue +Archive -bad', category: '3', order: 'mv', time: 'w' };
const book = { albumId: '123', chapterId: '124', title: 'Book title', chapterName: 'Chapter 2', page: 3, totalPages: 9 };
beforeEach(() => localStorage.clear());
function Destination() { const location = useLocation(); return <output data-testid="destination">{location.pathname}{location.search}|{JSON.stringify(location.state)}</output>; }
function historyUi() {
  return render(<MemoryRouter initialEntries={['/history']}><Routes><Route path="/history" element={<HistoryPage />} /><Route path="*" element={<Destination />} /></Routes></MemoryRouter>);
}

test('search history preserves whole queries and filters, deduplicates and bounds storage', () => {
  rememberSearch(query, 1);
  rememberSearch({ ...query, query: '  +blue +archive -bad  ' }, 2);
  assert.equal(getSearchHistory().length, 1);
  assert.equal(getSearchHistory()[0].updatedAt, 2);
  assert.equal(searchHistoryUrl(getSearchHistory()[0]), '/?q=%2Bblue+%2Barchive+-bad&cat=3&order=mv&time=w&page=1');
  rememberSearch({ ...query, query: '   ' });
  for (let i = 0; i < 40; i++) rememberSearch({ ...query, query: `term ${i}` }, i + 5);
  assert.equal(getSearchHistory().length, 30);
  assert.equal(getSearchHistory()[0].query, 'term 39');
  removeSearchHistory(searchHistoryId(getSearchHistory()[0]));
  assert.equal(getSearchHistory().length, 29);
  clearSearchHistory();
  assert.deepEqual(getSearchHistory(), []);
});

test('reading history deduplicates by work, keeps progress and rejects invalid records', () => {
  rememberReading(book, 100);
  rememberReading(book, 101);
  assert.equal(getReadingHistory()[0].updatedAt, 100);
  rememberReading({ ...book, page: 4 }, 102);
  assert.equal(getReadingHistory()[0].page, 4);
  rememberReading({ ...book, page: -1 });
  rememberReading({ ...book, page: 10 });
  assert.equal(getReadingHistory().length, 1);
  for (let i = 1; i <= 205; i++) rememberReading({ ...book, albumId: String(i) }, 30_000 + i);
  assert.equal(getReadingHistory().length, 200);
  removeReadingHistory('205');
  assert.equal(getReadingHistory().length, 199);
  clearReadingHistory();
  assert.deepEqual(getReadingHistory(), []);
});

test('migrates legacy progress with cached names, repairs root zero and never reimports cleared entries', () => {
  localStorage.setItem('reading-progress:0:124', JSON.stringify({ ...book, albumId: '0', chapterIndex: 0, updatedAt: 100 }));
  localStorage.setItem('reader-album-cache:124', JSON.stringify({ album: { name: 'Legacy title' } }));
  localStorage.setItem('reading-progress:999:1', 'broken');
  localStorage.setItem('reading-progress:123:125', JSON.stringify({ ...book, chapterId: '125', updatedAt: 200 }));
  localStorage.setItem('reading-progress:123:126', JSON.stringify({ ...book, chapterId: '126', updatedAt: 150 }));
  localStorage.setItem('reading-progress:invalid', '{}');
  importReadingProgress();
  assert.deepEqual(getReadingHistory().map(x => x.albumId), ['123', '124']);
  assert.equal(getReadingHistory()[1].title, 'Legacy title');
  assert.equal(getReadingHistory()[0].title, '作品 123');
  clearReadingHistory(); importReadingProgress();
  assert.deepEqual(getReadingHistory(), []);
});

test('corrupt or blocked storage does not crash search, history or migration', () => {
  for (const raw of ['broken', '{}', '[null,{},false]']) {
    localStorage.setItem(SEARCH_HISTORY_KEY, raw); localStorage.setItem(READING_HISTORY_KEY, raw);
    assert.deepEqual(getSearchHistory(), []); assert.deepEqual(getReadingHistory(), []);
  }
  const get = vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  const set = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('full'); });
  rememberSearch(query); rememberReading(book); importReadingProgress();
  assert.deepEqual(getSearchHistory(), []); assert.deepEqual(getReadingHistory(), []);
  get.mockRestore(); set.mockRestore();
});

test('history screen resumes the exact chapter/page and supports deleting and clearing records', () => {
  rememberReading(book);
  historyUi();
  fireEvent.click(screen.getByRole('link', { name: /Book title/ }));
  assert.match(screen.getByTestId('destination').textContent!, /^\/reader\/124\|.*"resumePage":3/);
});

test('history screen stays in sync with writes and deletions in this tab and storage events', () => {
  historyUi();
  assert.ok(screen.getByText(/暂无阅读记录/));
  act(() => { rememberReading(book); rememberSearch(query); });
  assert.ok(screen.getByText('Book title'));
  fireEvent.click(screen.getByRole('button', { name: '删除阅读记录 Book title' }));
  assert.ok(screen.getByText(/暂无阅读记录/));
  act(() => { rememberReading({ ...book, chapterName: '' }); });
  fireEvent.click(screen.getByRole('button', { name: '清空阅读历史' }));
  fireEvent.click(screen.getByRole('button', { name: '删除搜索记录 +Blue +Archive -bad' }));
  assert.equal(screen.queryByRole('region', { name: '搜索历史' }), null);
  act(() => { localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify([{ ...query, updatedAt: 1 }])); window.dispatchEvent(new StorageEvent('storage')); });
  fireEvent.click(screen.getByRole('button', { name: '清空搜索历史' }));
  assert.deepEqual(getSearchHistory(), []);
});

test('compact recent searches reopen whole queries without converting them into one tag', () => {
  for (let i = 0; i < 10; i++) rememberSearch({ ...query, query: `term ${i}` });
  render(<MemoryRouter><SearchHistory compact /><Destination /></MemoryRouter>);
  assert.equal(screen.queryByRole('button', { name: 'term 0', exact: true }), null);
  fireEvent.click(screen.getByRole('button', { name: 'term 9', exact: true }));
  assert.match(screen.getByTestId('destination').textContent!, /q=term\+9&cat=3&order=mv&time=w/);
});
