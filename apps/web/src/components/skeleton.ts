// 骨格の描き方の共通部分。動画に重ねる canvas と、保存した静止画に重ねる SVG の両方で使う。

import {
  applyAffine,
  DEFAULT_VISIBILITY_THRESHOLD,
  IDENTITY,
  isPointUsable,
  LANDMARK_NAMES,
  SKELETON_EDGES,
  type Affine,
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
  // 比較画面で重ねる「基準」の骨格。緑と見分けやすい桃色にし、色の見分けにくい人のために点線にもする
  base: 'rgb(255, 110, 210)',
} as const;

/** 線の太さ・点の大きさ。描く範囲の長い辺を 1000 としたときの値 */
export const SKELETON_SIZES = { line: 3, outline: 6, dot: 5, dotOutline: 6.5 } as const;

export interface SkeletonParts {
  edges: Array<{ a: Point; b: Point; usable: boolean }>;
  points: Array<{ p: Point; usable: boolean }>;
}

/**
 * 骨格の線と点。transform を渡すと、位置をその移し替えで動かす（別の記録の画像に重ねるとき）。
 * 計測に使える点かどうかは、動かす前の位置（その記録の画像の中にあるか）で決める。
 */
export function skeletonParts(
  landmarks: CommonLandmarks,
  imageSize: ImageSize,
  transform: Affine = IDENTITY,
): SkeletonParts {
  const ok = (name: (typeof LANDMARK_NAMES)[number]) =>
    isPointUsable(landmarks[name], DEFAULT_VISIBILITY_THRESHOLD, imageSize);
  const at = (name: (typeof LANDMARK_NAMES)[number]) => applyAffine(transform, landmarks[name]);
  return {
    edges: SKELETON_EDGES.map(([a, b]) => ({ a: at(a), b: at(b), usable: ok(a) && ok(b) })),
    points: LANDMARK_NAMES.map((name) => ({ p: at(name), usable: ok(name) })),
  };
}
