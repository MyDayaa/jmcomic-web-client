import assert from 'node:assert/strict';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';
import { rememberEngagement, seedEngagement, useEngagement } from '../src/extended/engagement';

beforeEach(() => { localStorage.clear(); window.dispatchEvent(new StorageEvent('storage')); });

test('account-scoped confirmed states survive reload, cancel favorites and react to cross-tab changes', () => {
  const one = renderHook(() => useEngagement('1', '123'));
  const two = renderHook(() => useEngagement('2', '123'));
  assert.deepEqual(one.result.current, { favorite: undefined, liked: false });
  act(() => rememberEngagement('1', '123', { favorite: true, liked: true }));
  assert.deepEqual(one.result.current, { favorite: true, liked: true });
  assert.deepEqual(two.result.current, { favorite: undefined, liked: false });
  act(() => rememberEngagement('1', '123', { favorite: false }));
  assert.deepEqual(one.result.current, { favorite: false, liked: true });
  act(() => seedEngagement('1', '123', { favorite: true, liked: false }));
  assert.deepEqual(one.result.current, { favorite: false, liked: true });
  one.unmount();
  assert.equal(renderHook(() => useEngagement('1', '123')).result.current.favorite, false);
  act(() => { localStorage.clear(); window.dispatchEvent(new StorageEvent('storage')); });
  assert.equal(two.result.current.favorite, undefined);
});

test('unavailable or corrupt storage cannot prevent visible state changes after successful writes', () => {
  for (const raw of ['null', '[]', 'broken']) {
    localStorage.setItem('jm-album-state:v1:1', raw);
    const hook = renderHook(() => useEngagement('1', '123'));
    assert.equal(hook.result.current.liked, false); hook.unmount();
  }
  const get = vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  const set = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('full'); });
  const hook = renderHook(() => useEngagement('1', '123'));
  act(() => { rememberEngagement('', '123', { liked: true }); rememberEngagement('1', 'bad', { liked: true }); });
  assert.equal(hook.result.current.liked, false);
  act(() => rememberEngagement('1', '123', { liked: true }));
  assert.equal(hook.result.current.liked, true);
  get.mockRestore(); set.mockRestore();
  act(() => rememberEngagement('1', '123', { favorite: false }));
  assert.equal(hook.result.current.favorite, false);
});

test('bounds retained account states and ignores malformed saved button flags', () => {
  localStorage.setItem('jm-album-state:v1:1', JSON.stringify({ '123': { favorite: 'invalid', liked: 'true' }, '0': null }));
  const hook = renderHook(() => useEngagement('1', '123'));
  assert.deepEqual(hook.result.current, { favorite: undefined, liked: false });
  act(() => { for (let i = 1; i <= 505; i++) rememberEngagement('1', String(i), { liked: true }); });
  assert.equal(Object.keys(JSON.parse(localStorage.getItem('jm-album-state:v1:1')!)).length, 500);
});
