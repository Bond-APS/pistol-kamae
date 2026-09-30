// 点数（1 動画 1 発の点数）の入力と表示。
// AP の 1 発は 0〜10.9（決勝の小数採点）。整数採点の「10」もそのまま受け付ける。

export const SCORE_MIN = 0;
export const SCORE_MAX = 10.9;

export type ScoreParseResult =
  { ok: true; value: number | null } | { ok: false; reason: 'notNumber' | 'outOfRange' };

/**
 * 入力欄の文字列を点数に直す。
 * 空欄は null（未入力）。全角の数字と小数点、「,」（小数点にカンマを使う地域の数字キーボード）も受け付ける。
 * 小数は 1 桁まで。
 */
export function parseScore(text: string): ScoreParseResult {
  const normalized = text.normalize('NFKC').trim().replace(',', '.');
  if (normalized === '') return { ok: true, value: null };
  if (!/^\d+(\.\d)?$/.test(normalized)) return { ok: false, reason: 'notNumber' };
  const value = Number(normalized);
  if (value < SCORE_MIN || value > SCORE_MAX) return { ok: false, reason: 'outOfRange' };
  return { ok: true, value };
}

/** 保存できる点数か（null は未入力として可） */
export function isValidScore(value: unknown): value is number | null {
  if (value === null) return true;
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= SCORE_MIN &&
    value <= SCORE_MAX &&
    Math.abs(value * 10 - Math.round(value * 10)) < 1e-9
  );
}

/** 表示用の文字列。入力どおりに出す（10 を 10.0 に変えない） */
export function formatScore(value: number): string {
  return String(Math.round(value * 10) / 10);
}
