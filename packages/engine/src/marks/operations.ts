import { SHOT_MARK_ID, type Mark } from './types';

/** 時刻順に並べる。同じ時刻なら撃発を先にし、任意マークは追加した順を保つ */
function sorted(marks: ReadonlyArray<Mark>): Mark[] {
  return marks
    .map((mark, order) => ({ mark, order }))
    .sort(
      (a, b) =>
        a.mark.timeSec - b.mark.timeSec ||
        Number(b.mark.kind === 'shot') - Number(a.mark.kind === 'shot') ||
        a.order - b.order,
    )
    .map((e) => e.mark);
}

/** 撃発マーク。まだ付けていなければ null */
export function shotMarkOf(marks: ReadonlyArray<Mark>): Mark | null {
  return marks.find((m) => m.kind === 'shot') ?? null;
}

/** 撃発マークを付ける。すでにあれば付け直す（1 動画に 1 つ） */
export function setShotMark(marks: ReadonlyArray<Mark>, timeSec: number): Mark[] {
  const others = marks.filter((m) => m.kind !== 'shot');
  return sorted([...others, { id: SHOT_MARK_ID, kind: 'shot', label: '', timeSec }]);
}

/** 任意マークの名前を整える（前後の空白を除く）。空なら null */
export function normalizeMarkLabel(label: string): string | null {
  const trimmed = label.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * その名前の任意マークがすでにあるか（前後の空白は無視して比べる）。
 * 同じ名前は 1 動画に 1 つまで。2 つの動画を揃える同期点に任意マークを選ぶとき、
 * 同名が複数あるとどれを使うか決められなくなるため。
 */
export function hasCustomMarkLabel(marks: ReadonlyArray<Mark>, label: string): boolean {
  const normalized = normalizeMarkLabel(label);
  return normalized !== null && marks.some((m) => m.kind === 'custom' && m.label === normalized);
}

/**
 * 任意マークを追加する。
 * 名前が空、同じ名前の任意マークがすでにある、または id が重複している場合は、
 * 何もせず元の一覧を返す。
 */
export function addCustomMark(
  marks: ReadonlyArray<Mark>,
  mark: { id: string; label: string; timeSec: number },
): Mark[] {
  const label = normalizeMarkLabel(mark.label);
  if (label === null || hasCustomMarkLabel(marks, label) || marks.some((m) => m.id === mark.id)) {
    return [...marks];
  }
  return sorted([...marks, { id: mark.id, kind: 'custom', label, timeSec: mark.timeSec }]);
}

/** 任意マーク用の、まだ使われていない id（c1, c2, …）を返す */
export function nextMarkId(marks: ReadonlyArray<Mark>): string {
  let max = 0;
  for (const m of marks) {
    const n = /^c(\d+)$/.exec(m.id)?.[1];
    if (n !== undefined) max = Math.max(max, Number(n));
  }
  return `c${max + 1}`;
}

/** マークを削除する（撃発マークも削除できる） */
export function removeMark(marks: ReadonlyArray<Mark>, id: string): Mark[] {
  return marks.filter((m) => m.id !== id);
}
