import type { CSSProperties } from 'react';
import type { ReadingDirection } from './reader-store';

export function getSpreadStart(page: number, doublePage: boolean) {
  return doublePage ? Math.floor(page / 2) * 2 : page;
}

export function getReaderAnchorRatio(viewportCenter: number, pageStart: number, pageSize: number) {
  return Math.max(0, Math.min(1, (viewportCenter - pageStart) / Math.max(pageSize, 1)));
}

export function getReaderAnchorScrollPosition({
  pageStart,
  pageSize,
  offsetRatio,
  viewportSize,
  maxScroll,
}: {
  pageStart: number;
  pageSize: number;
  offsetRatio: number;
  viewportSize: number;
  maxScroll: number;
}) {
  const position = pageStart + pageSize * offsetRatio - viewportSize / 2;
  return Math.max(0, Math.min(maxScroll, position));
}

export function getReaderInteractionPolicy({
  autoSnap,
  seamlessMode,
  isZoomed,
}: {
  autoSnap: boolean;
  seamlessMode: boolean;
  isZoomed: boolean;
}) {
  return {
    snapEnabled: autoSnap && !isZoomed,
    zoomTarget: seamlessMode && !autoSnap ? 'visible-pages' : 'single-image',
  } as const;
}

export function getReaderPageStyle({
  direction,
  seamlessMode,
  aspectRatio,
  snapEnabled,
  doublePage = false,
  pageIndex = 0,
  lastPage = false,
}: {
  direction: ReadingDirection;
  seamlessMode: boolean;
  aspectRatio?: number;
  snapEnabled: boolean;
  doublePage?: boolean;
  pageIndex?: number;
  lastPage?: boolean;
}): CSSProperties {
  if (doublePage && direction !== 'top-down') {
    return {
      flex: '0 0 50%', width: '50%', height: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      scrollSnapAlign: snapEnabled && pageIndex % 2 === 0 ? 'start' : undefined,
      scrollSnapStop: snapEnabled && pageIndex % 2 === 0 ? 'always' : undefined,
      [direction === 'right-left' ? 'marginLeft' : 'marginRight']: lastPage && pageIndex % 2 === 0 ? '50%' : undefined,
    };
  }
  const snapStyle: CSSProperties = {
    scrollSnapAlign: snapEnabled ? 'start' : undefined,
    scrollSnapStop: snapEnabled ? 'always' : undefined,
  };

  if (direction !== 'top-down') {
    if (seamlessMode) {
      return {
        flex: aspectRatio ? '0 0 auto' : '0 0 100%',
        width: aspectRatio ? 'auto' : '100%',
        height: '100%',
        aspectRatio,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...snapStyle,
      };
    }
    return {
      flex: '0 0 100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      ...snapStyle,
    };
  }

  if (seamlessMode) {
    return {
      flex: aspectRatio ? '0 0 auto' : '0 0 100%',
      width: '100%',
      height: aspectRatio ? 'auto' : '100%',
      aspectRatio,
      display: 'block',
      ...snapStyle,
    };
  }
  return {
    flex: aspectRatio ? '0 0 auto' : '0 0 100%',
    width: '100%',
    height: aspectRatio ? 'auto' : '100%',
    aspectRatio,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    ...snapStyle,
  };
}
