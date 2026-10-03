import type { LandmarkFrame } from '@pistol-kamae/engine';

// 時刻からフレーム番号を求める関数は engine に置いた（マークの時刻から角度を取り出すのに使うため）
import { frameIndexAt } from '@pistol-kamae/engine';
export { frameIndexAt };

/**
 * フレーム i を確実に表示させるためのシーク先の時刻。
 * 境界ぴったりだと前後どちらが表示されるか曖昧になるため、次のフレームとの中間を狙う。
 */
export function seekTimeForFrame(frames: LandmarkFrame[], index: number, fps: number): number {
  const frame = frames[index]!;
  const next = frames[index + 1];
  const end = next ? next.timeSec : frame.timeSec + 1 / fps;
  return (frame.timeSec + end) / 2;
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
