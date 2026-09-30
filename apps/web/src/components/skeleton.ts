// 骨格の描き方の共通部分。動画に重ねる canvas と、保存した静止画に重ねる SVG の両方で使う。

import {
  DEFAULT_VISIBILITY_THRESHOLD,
  isPointUsable,
  LANDMARK_NAMES,
  SKELETON_EDGES,
  type CommonLandmarks,
  type ImageSize,
  type Point,
} from '@pistol-kamae/engine';

/** 計測に使う点・線の色、使わない点（よく見えない・画面の外）の色、縁取りの色 */
export const SKELETON_COLORS = {
  usable: 'rgb(0, 220, 90)',
  unusable: 'rgb(160, 160, 160)',
  // 白い壁などの明るい背景でも線が見えるよう、暗い縁取りを付ける
  outline: 'rgba(0, 0, 0, 0.75)',
} as const;

/** 線の太さ・点の大きさ。描く範囲の長い辺を 1000 としたときの値 */
export const SKELETON_SIZES = { line: 3, outline: 6, dot: 5, dotOutline: 6.5 } as const;

export interface SkeletonParts {
  edges: Array<{ a: Point; b: Point; usable: boolean }>;
  points: Array<{ p: Point; usable: boolean }>;
}

export function skeletonParts(landmarks: CommonLandmarks, imageSize: ImageSize): SkeletonParts {
  const ok = (name: (typeof LANDMARK_NAMES)[number]) =>
    isPointUsable(landmarks[name], DEFAULT_VISIBILITY_THRESHOLD, imageSize);
  return {
    edges: SKELETON_EDGES.map(([a, b]) => ({
      a: landmarks[a],
      b: landmarks[b],
      usable: ok(a) && ok(b),
    })),
    points: LANDMARK_NAMES.map((name) => ({ p: landmarks[name], usable: ok(name) })),
  };
}
