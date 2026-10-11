import type { LandmarkFrame } from '@pistol-kamae/engine';

// 時刻からフレーム番号を求める関数は engine に置いた（マークの時刻から角度を取り出すのに使うため）
import { frameIndexAt } from '@pistol-kamae/engine';
export { frameIndexAt };

/** 実時刻のコマのシーク先を、そのコマの始まりからどれだけ後ろにするか（秒） */
const EXACT_SEEK_OFFSET_SEC = 0.002;

/**
 * フレーム i を確実に表示させるためのシーク先の時刻。
 * 時刻が実時刻（実際に表示されたコマの始まり。exact）なら、その少しあと（2 ミリ秒）を狙う。解析でコマを
 * 飛ばしていても（60 fps の動画を 30 と推定したときなど）、飛ばしたコマの始まりより手前なので同じコマが出る（最終-15）。
 * 名目の時刻（コマ番号 ÷ fps）なら、境界ぴったりで前後どちらが表示されるか曖昧になるため、次のフレームとの中間を狙う
 * （解析のときのシーク先と同じ）。
 */
export function seekTimeForFrame(
  frames: ReadonlyArray<LandmarkFrame>,
  index: number,
  fps: number,
): number {
  const frame = frames[index]!;
  const next = frames[index + 1];
  const end = next ? next.timeSec : frame.timeSec + 1 / fps;
  const middle = (frame.timeSec + end) / 2;
  return frame.exact ? Math.min(frame.timeSec + EXACT_SEEK_OFFSET_SEC, middle) : middle;
}

/**
 * 切り抜きの範囲の端をコマの時刻に吸着させ、動画の中に収める。
 * 終了が最後のコマの時刻以上なら動画の長さ（＝終わりまで）、開始が最初のコマの時刻以下なら 0 にする。
 * 取っ手を端まで戻したときに「全体」に戻るように（最後のコマの時刻に吸着させると 1 コマ分短く記録される。最終-27）
 */
export function snapClipEdges(
  frames: ReadonlyArray<LandmarkFrame>,
  startSec: number,
  endSec: number,
  durationSec: number,
): { startSec: number; endSec: number } {
  const first = frames[0]?.timeSec ?? 0;
  const last = frames[frames.length - 1]?.timeSec ?? durationSec;
  const s = snapToFrame(frames, startSec);
  const e = snapToFrame(frames, endSec);
  return {
    startSec: s <= first ? 0 : Math.max(s, 0),
    endSec: e >= last ? durationSec : Math.min(e, durationSec),
  };
}

/**
 * 時刻にいちばん近いフレームの番号（範囲の外は端のフレーム）。
 * 求めた時刻がフレームの境目ぴったりになりやすいとき（連動で相手の時点を求めるときなど）、
 * 「その時刻を含むフレーム」で選ぶと計算の丸めで 1 コマ手前になることがあるため、近い方を選ぶ
 */
export function nearestFrameIndex(frames: ReadonlyArray<LandmarkFrame>, timeSec: number): number {
  if (frames.length === 0) return 0;
  const i = Math.max(frameIndexAt(frames, Math.max(timeSec, 0)), 0);
  const next = frames[i + 1];
  if (!next) return i;
  return next.timeSec - timeSec < timeSec - frames[i]!.timeSec ? i + 1 : i;
}

/** 時刻にいちばん近いコマの時刻（コマがなければそのまま） */
export function snapToFrame(frames: ReadonlyArray<LandmarkFrame>, timeSec: number): number {
  return frames[nearestFrameIndex(frames, timeSec)]?.timeSec ?? timeSec;
}

/**
 * timeSec 以上（orAfter なら timeSec より後）の時刻を持つ最初のコマの番号（なければ frames.length）。
 * 二分探索（並んだデータを半分ずつ絞って探す）
 */
function firstFrameFrom(
  frames: ReadonlyArray<LandmarkFrame>,
  timeSec: number,
  orAfter = false,
): number {
  let lo = 0;
  let hi = frames.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const t = frames[mid]!.timeSec;
    if (orAfter ? t <= timeSec : t < timeSec) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * 範囲 [startSec, endSec] に入るコマの番号の最初と最後。範囲にコマがなければ、いちばん近い 1 コマ。
 * 再生中にコマごとに呼ばれるので、先頭から順に数えずに二分探索で求める（コマ数が増えても速さが変わらない）
 */
export function frameRange(
  frames: ReadonlyArray<LandmarkFrame>,
  startSec: number,
  endSec: number,
): { first: number; last: number } {
  // 境目の丸めで外れないよう、ごくわずかの余裕を持たせる
  const eps = 1e-6;
  let first = firstFrameFrom(frames, startSec - eps);
  if (first >= frames.length) first = frames.length - 1;
  // endSec + eps 以下の最後のコマ。first より手前にはしない（範囲にコマがないとき）
  const last = Math.max(firstFrameFrom(frames, endSec + eps, true) - 1, first);
  return { first, last };
}

/** 範囲の中で、時刻にいちばん近いコマの番号 */
export function nearestFrameInRange(
  frames: ReadonlyArray<LandmarkFrame>,
  timeSec: number,
  startSec: number,
  endSec: number,
): number {
  const { first, last } = frameRange(frames, startSec, endSec);
  return Math.min(Math.max(nearestFrameIndex(frames, timeSec), first), last);
}
