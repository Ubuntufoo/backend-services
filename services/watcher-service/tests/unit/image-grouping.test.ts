import { describe, expect, it } from 'vitest';
import {
  EMPTY_WATCHER_GROUPING_STATE,
  consumeImageGrouping,
  createEmptyWatcherGroupingState,
} from '../../src/index.js';

describe('watcher image grouping', () => {
  it('emits complete 2-image groups', () => {
    const result = consumeImageGrouping('single_2_image', ['a.jpg', 'b.jpg']);

    expect(result.completedGroups).toEqual([
      {
        captureMode: 'single_2_image',
        images: [{ path: 'a.jpg' }, { path: 'b.jpg' }],
      },
    ]);
    expect(result.state.pending).toEqual([]);
  });

  it('emits complete 3-image groups', () => {
    const result = consumeImageGrouping('lot_3_image', ['a.jpg', 'b.jpg', 'c.jpg']);

    expect(result.completedGroups).toEqual([
      {
        captureMode: 'lot_3_image',
        images: [{ path: 'a.jpg' }, { path: 'b.jpg' }, { path: 'c.jpg' }],
      },
    ]);
    expect(result.state.pending).toEqual([]);
  });

  it('preserves pending incomplete groups', () => {
    const result = consumeImageGrouping('lot_3_image', ['a.jpg', 'b.jpg']);

    expect(result.completedGroups).toEqual([]);
    expect(result.state.pending).toEqual([{ path: 'a.jpg' }, { path: 'b.jpg' }]);
  });

  it('ignores unsupported extensions', () => {
    const result = consumeImageGrouping('single_2_image', ['a.jpg', 'skip.gif', 'b.png']);

    expect(result.completedGroups).toEqual([
      {
        captureMode: 'single_2_image',
        images: [{ path: 'a.jpg' }, { path: 'b.png' }],
      },
    ]);
    expect(result.state.pending).toEqual([]);
  });

  it('preserves ordering across pending state and completed groups', () => {
    const first = consumeImageGrouping('single_2_image', ['a.jpg'], {
      pending: [{ path: 'z.jpg' }],
    });

    expect(first.completedGroups).toEqual([
      {
        captureMode: 'single_2_image',
        images: [{ path: 'z.jpg' }, { path: 'a.jpg' }],
      },
    ]);
    expect(first.state.pending).toEqual([]);
  });

  it('supports multiple sequential groups', () => {
    const result = consumeImageGrouping('single_2_image', [
      'a.jpg',
      'b.jpg',
      'c.jpg',
      'd.jpg',
      'e.jpg',
    ]);

    expect(result.completedGroups).toEqual([
      {
        captureMode: 'single_2_image',
        images: [{ path: 'a.jpg' }, { path: 'b.jpg' }],
      },
      {
        captureMode: 'single_2_image',
        images: [{ path: 'c.jpg' }, { path: 'd.jpg' }],
      },
    ]);
    expect(result.state.pending).toEqual([{ path: 'e.jpg' }]);
  });

  it('does not leak state across runs', () => {
    const first = consumeImageGrouping('single_2_image', ['a.jpg'], EMPTY_WATCHER_GROUPING_STATE);
    const second = consumeImageGrouping('single_2_image', ['b.jpg'], EMPTY_WATCHER_GROUPING_STATE);
    const fresh = createEmptyWatcherGroupingState();

    expect(first.completedGroups).toEqual([]);
    expect(first.state.pending).toEqual([{ path: 'a.jpg' }]);
    expect(second.completedGroups).toEqual([]);
    expect(second.state.pending).toEqual([{ path: 'b.jpg' }]);
    expect(EMPTY_WATCHER_GROUPING_STATE.pending).toEqual([]);
    expect(fresh).toEqual({ pending: [] });
  });

  it('returns empty output for empty input', () => {
    const result = consumeImageGrouping('lot_3_image', []);

    expect(result.completedGroups).toEqual([]);
    expect(result.state.pending).toEqual([]);
  });
});
