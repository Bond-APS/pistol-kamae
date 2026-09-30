// ライブラリ一覧の絞り込み・並べ替え・月ごとのまとめ（画面から切り離した計算だけの部分）。

import { parseLocalDateTime } from '@pistol-kamae/engine';

/** 一覧の計算に必要な項目だけ（RecordRow はこれを満たす） */
export interface ListItem {
  id: number;
  shooterId: number;
  shotAt: string;
  favorite: boolean;
}

export interface ListFilter {
  /** 絞り込む射手。null はすべて */
  shooterId: number | null;
  favoritesOnly: boolean;
}

export const NO_FILTER: ListFilter = { shooterId: null, favoritesOnly: false };

export function isFiltered(filter: ListFilter): boolean {
  return filter.shooterId !== null || filter.favoritesOnly;
}

/** 条件に合う記録を、撮影日時の新しい順に並べる（同じ日時なら後から保存したものを先に） */
export function filterAndSort<T extends ListItem>(rows: ReadonlyArray<T>, filter: ListFilter): T[] {
  return rows
    .filter(
      (r) =>
        (filter.shooterId === null || r.shooterId === filter.shooterId) &&
        (!filter.favoritesOnly || r.favorite),
    )
    .sort((a, b) => (a.shotAt < b.shotAt ? 1 : a.shotAt > b.shotAt ? -1 : b.id - a.id));
}

export interface MonthGroup<T> {
  year: number;
  month: number;
  rows: T[];
}

/** 並べ替え済みの記録を、撮影した月ごとにまとめる（並び順は保つ） */
export function groupByMonth<T extends ListItem>(sorted: ReadonlyArray<T>): MonthGroup<T>[] {
  const groups: MonthGroup<T>[] = [];
  for (const row of sorted) {
    const d = parseLocalDateTime(row.shotAt);
    const year = d?.year ?? 0;
    const month = d?.month ?? 0;
    const last = groups[groups.length - 1];
    if (last && last.year === year && last.month === month) last.rows.push(row);
    else groups.push({ year, month, rows: [row] });
  }
  return groups;
}

/** 射手ごとの件数（絞り込みの選択肢に出す） */
export function countByShooter(rows: ReadonlyArray<ListItem>): Map<number, number> {
  const counts = new Map<number, number>();
  for (const r of rows) counts.set(r.shooterId, (counts.get(r.shooterId) ?? 0) + 1);
  return counts;
}
