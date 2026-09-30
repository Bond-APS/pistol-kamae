// 人物が写っている範囲。静止画を人物に寄せて表示する・一覧用に切り抜くのに使う。

import { LANDMARK_NAMES, type CommonLandmarks } from './types';
import { DEFAULT_VISIBILITY_THRESHOLD, isPointUsable, type ImageSize } from './usable';

/** 画像上の長方形（画素） */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 計測に使える点（よく見えていて画面の中にある点）をすべて含む最小の長方形。
 * 使える点が 2 つ未満、または面積が 0 なら null。
 */
export function personBounds(
  landmarks: CommonLandmarks,
  imageSize: ImageSize,
  visibilityThreshold: number = DEFAULT_VISIBILITY_THRESHOLD,
): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let count = 0;
  for (const name of LANDMARK_NAMES) {
    const p = landmarks[name];
    if (!isPointUsable(p, visibilityThreshold, imageSize)) continue;
    count++;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (count < 2 || maxX <= minX || maxY <= minY) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** 画像からはみ出した分を切り落とす */
function clampRect(rect: Rect, imageSize: ImageSize): Rect {
  const x0 = Math.max(0, rect.x);
  const y0 = Math.max(0, rect.y);
  const x1 = Math.min(imageSize.width, rect.x + rect.width);
  const y1 = Math.min(imageSize.height, rect.y + rect.height);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * 長方形を四方に広げる（関節の点は体の輪郭より内側にあるため、頭の上や足先の分の余白を足す）。
 * 余白は長い辺の marginRatio 倍。画像からはみ出した分は切り落とす。
 */
export function expandRect(rect: Rect, marginRatio: number, imageSize: ImageSize): Rect {
  const margin = Math.max(rect.width, rect.height) * marginRatio;
  return clampRect(
    {
      x: rect.x - margin,
      y: rect.y - margin,
      width: rect.width + margin * 2,
      height: rect.height + margin * 2,
    },
    imageSize,
  );
}

/**
 * rect を中央に含む、縦横比 aspect（幅 ÷ 高さ）の長方形。画像の中に収める。
 * その比で rect を含む大きさが画像に入りきらないときは、画像に入る最大の大きさにする
 * （rect の端が切れることがある）。
 */
export function coverRect(rect: Rect, aspect: number, imageSize: ImageSize): Rect {
  let width = Math.max(rect.width, rect.height * aspect);
  let height = width / aspect;
  if (width > imageSize.width) {
    width = imageSize.width;
    height = width / aspect;
  }
  if (height > imageSize.height) {
    height = imageSize.height;
    width = height * aspect;
  }
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const x = Math.min(Math.max(cx - width / 2, 0), imageSize.width - width);
  const y = Math.min(Math.max(cy - height / 2, 0), imageSize.height - height);
  return { x, y, width, height };
}
