import type { LandmarkFrame } from '@pistol-kamae/engine';

// 時刻からフレーム番号を求める関数は engine に置いた（マークの時刻から角度を取り出すのに使うため）
export { frameIndexAt } from '@pistol-kamae/engine';

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
