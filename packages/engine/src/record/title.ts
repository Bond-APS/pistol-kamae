// 記録のタイトルとメモ（段階⑤）。タイトルの初期値は撮影日時で、利用者が自由に変えられる。

import { parseLocalDateTime } from './dateTime';

export const TITLE_MAX_LENGTH = 60;
export const MEMO_MAX_LENGTH = 100;

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** 撮影日時（'YYYY-MM-DDTHH:mm'）から初期値のタイトル 'YYYY-MM-DD HH:mm' を作る。日時が不正なら空 */
export function defaultTitle(shotAt: string): string {
  const d = parseLocalDateTime(shotAt);
  if (!d) return '';
  return `${pad(d.year, 4)}-${pad(d.month)}-${pad(d.day)} ${pad(d.hour)}:${pad(d.minute)}`;
}

/** タイトルを整える（前後の空白を除く）。空、または長すぎれば null */
export function normalizeTitle(title: string): string | null {
  const trimmed = title.trim();
  return trimmed === '' || trimmed.length > TITLE_MAX_LENGTH ? null : trimmed;
}

/** メモを整える（前後の空白を除く）。長すぎれば null（空は可） */
export function normalizeMemo(memo: string): string | null {
  const trimmed = memo.trim();
  return trimmed.length > MEMO_MAX_LENGTH ? null : trimmed;
}
