import type { ChapterDirection } from './navigation';

export type ReaderWheelMode = 'native' | 'continuous' | 'paged';

export function getReaderWheelMode({
  horizontal,
  autoSnap,
  trackpad,
}: {
  horizontal: boolean;
  autoSnap: boolean;
  trackpad: boolean;
}): ReaderWheelMode {
  if (!horizontal) return 'native';
  if (trackpad && !autoSnap) return 'continuous';
  return 'paged';
}

export function canTrackpadSwitchAtBoundary(
  startedAtBoundary: ChapterDirection | null,
  currentBoundary: ChapterDirection,
) {
  return startedAtBoundary === currentBoundary;
}

export function getAnimatedScrollBehavior(reducedMotion: boolean): ScrollBehavior {
  return reducedMotion ? 'instant' : 'smooth';
}

export function getSeekPageFromKey({
  key,
  currentPage,
  totalPages,
  pageStep = 10,
  arrowStep = 1,
}: {
  key: string;
  currentPage: number;
  totalPages: number;
  pageStep?: number;
  arrowStep?: number;
}): number | null {
  const lastPage = Math.max(0, totalPages - 1);
  const targets: Record<string, number> = {
    ArrowLeft: currentPage - arrowStep,
    ArrowUp: currentPage - arrowStep,
    ArrowRight: currentPage + arrowStep,
    ArrowDown: currentPage + arrowStep,
    Home: 0,
    End: lastPage,
    PageUp: currentPage - pageStep,
    PageDown: currentPage + pageStep,
  };
  const target = targets[key];
  return target === undefined ? null : Math.max(0, Math.min(lastPage, target));
}
