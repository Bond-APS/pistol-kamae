// いま読み込んでいる解析結果が、ライブラリのどの記録として保存済みかを表す。

import type { Mark } from '@pistol-kamae/engine';
import type { RecordFields } from '../db/library';

export interface SavedState {
  recordId: number;
  /** 保存した時点のマーク。今のマークと違えば「保存後に変更あり」 */
  marksKey: string;
  /** 保存した内容（保存後の案内に出す） */
  fields: RecordFields;
}

export const marksKeyOf = (marks: ReadonlyArray<Mark>): string => JSON.stringify(marks);

/** 保存後にマークを変えたか */
export function isChangedAfterSave(marks: ReadonlyArray<Mark>, saved: SavedState | null): boolean {
  return saved !== null && saved.marksKey !== marksKeyOf(marks);
}

/** 保存していないマークがあるか（動画の選び直しなどで消える前に確認するため） */
export function hasUnsavedMarks(marks: ReadonlyArray<Mark>, saved: SavedState | null): boolean {
  if (saved === null) return marks.length > 0;
  return isChangedAfterSave(marks, saved);
}
