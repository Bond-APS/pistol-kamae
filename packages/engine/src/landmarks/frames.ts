import type { LandmarkFrame } from './types';

/** 時刻の比較に使う許容誤差（秒）。浮動小数点の丸めを吸収する */
const EPSILON = 1e-4;

/**
 * 時刻 timeSec を含むフレームの番号。
 * フレーム i は [frames[i].timeSec, frames[i+1].timeSec) の区間を受け持つとみなす。
 * 先頭より前なら 0、フレームがなければ -1。
 */
export function frameIndexAt(frames: ReadonlyArray<LandmarkFrame>, timeSec: number): number {
  if (frames.length === 0) return -1;
  const t = timeSec + EPSILON;
  // 二分探索：timeSec 以下の最後のフレーム
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid]!.timeSec <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
