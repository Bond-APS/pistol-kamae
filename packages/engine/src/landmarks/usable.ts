import type { Point } from './types';

/** この値未満の visibility の点は計測から外す（既定値） */
export const DEFAULT_VISIBILITY_THRESHOLD = 0.5;

/** 動画の大きさ（画素） */
export interface ImageSize {
  width: number;
  height: number;
}

/**
 * その点を計測に使ってよいか。
 * visibility が閾値以上で、かつ画面の中にあること。
 * 姿勢推定モデルは、画面の外にはみ出した関節（例：足首が切れた動画）の位置も推測し、
 * 高い visibility を付けて返すことがある。推測による位置は信頼できないので使わない。
 * imageSize を渡さなければ、画面の内外は調べない。
 */
export function isPointUsable(
  point: Point,
  visibilityThreshold: number = DEFAULT_VISIBILITY_THRESHOLD,
  imageSize?: ImageSize,
): boolean {
  if (!(point.visibility >= visibilityThreshold)) return false;
  if (!imageSize) return true;
  return point.x >= 0 && point.x <= imageSize.width && point.y >= 0 && point.y <= imageSize.height;
}
