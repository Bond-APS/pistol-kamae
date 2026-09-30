// 射手。利き手は射手ごとに決まっているので、名前と一緒に 1 回だけ登録する。

import type { Handedness } from '../normalize/handedness';

export interface Shooter {
  name: string;
  handedness: Handedness;
}

export const SHOOTER_NAME_MAX_LENGTH = 30;

/** 射手名を整える（前後の空白を除く）。空、または長すぎれば null */
export function normalizeShooterName(name: string): string | null {
  const trimmed = name.trim();
  return trimmed === '' || trimmed.length > SHOOTER_NAME_MAX_LENGTH ? null : trimmed;
}

/**
 * その名前の射手がすでにいるか（前後の空白は無視して比べる）。
 * 同じ名前は 1 人まで。一覧の絞り込みで区別できなくなるため。
 * 射手を編集するときは、その射手の今の名前を exceptName に渡して自分自身を除く。
 */
export function hasShooterName(
  shooters: ReadonlyArray<{ name: string }>,
  name: string,
  exceptName?: string,
): boolean {
  const normalized = normalizeShooterName(name);
  if (normalized === null || normalized === exceptName) return false;
  return shooters.some((s) => s.name === normalized);
}
