import { describe, expect, it } from 'vitest';
import {
  NO_FILTER,
  countByShooter,
  filterAndSort,
  groupByMonth,
  isFiltered,
  type ListItem,
} from './listView';

const rows: ListItem[] = [
  { id: 1, shooterId: 1, shotAt: '2026-08-29T15:40', favorite: true },
  { id: 2, shooterId: 2, shotAt: '2026-09-23T10:20', favorite: false },
  { id: 3, shooterId: 1, shotAt: '2026-09-30T13:52', favorite: false },
  { id: 4, shooterId: 1, shotAt: '2026-09-30T14:05', favorite: true },
  { id: 5, shooterId: 1, shotAt: '2026-09-30T14:05', favorite: false },
];

describe('filterAndSort', () => {
  it('撮影日時の新しい順。同じ日時なら後から保存したものが先', () => {
    expect(filterAndSort(rows, NO_FILTER).map((r) => r.id)).toEqual([5, 4, 3, 2, 1]);
  });

  it('射手で絞り込む', () => {
    expect(filterAndSort(rows, { shooterId: 2, favoritesOnly: false }).map((r) => r.id)).toEqual([
      2,
    ]);
  });

  it('お気に入りだけに絞り込む（射手との組み合わせも）', () => {
    expect(filterAndSort(rows, { shooterId: null, favoritesOnly: true }).map((r) => r.id)).toEqual([
      4, 1,
    ]);
    expect(filterAndSort(rows, { shooterId: 2, favoritesOnly: true })).toEqual([]);
  });

  it('元の一覧を書き換えない', () => {
    const before = rows.map((r) => r.id);
    filterAndSort(rows, NO_FILTER);
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});

describe('groupByMonth', () => {
  it('撮影した月ごとにまとめ、並び順を保つ', () => {
    const groups = groupByMonth(filterAndSort(rows, NO_FILTER));
    expect(groups.map((g) => [g.year, g.month, g.rows.map((r) => r.id)])).toEqual([
      [2026, 9, [5, 4, 3, 2]],
      [2026, 8, [1]],
    ]);
  });

  it('0 件なら空', () => {
    expect(groupByMonth([])).toEqual([]);
  });
});

describe('countByShooter・isFiltered', () => {
  it('射手ごとの件数', () => {
    expect([...countByShooter(rows)]).toEqual([
      [1, 4],
      [2, 1],
    ]);
  });

  it('絞り込み中かどうか', () => {
    expect(isFiltered(NO_FILTER)).toBe(false);
    expect(isFiltered({ shooterId: 1, favoritesOnly: false })).toBe(true);
    expect(isFiltered({ shooterId: null, favoritesOnly: true })).toBe(true);
  });
});
