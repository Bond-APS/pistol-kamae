// 重ね描き用の正規化（要件 6.4）。
// 2 つの骨格を、腰の中心が重なり、体幹の長さ（腰の中心 → 肩の中心）が同じになるように揃える。
// カメラの位置や拡大率が違う動画どうしでも、姿勢の形だけを比べられるようにするため。

import type { CommonLandmarks } from '../landmarks/types';
import { DEFAULT_VISIBILITY_THRESHOLD, isPointUsable, type ImageSize } from '../landmarks/usable';
import {
  applyAffine,
  composeAffine,
  rotationAbout,
  scalingAbout,
  translation,
  type Affine,
  type Vec2,
} from './affine';

/** 位置合わせの手がかり：腰の中心と体幹の長さ */
export interface BodyAnchor {
  hipCenter: Vec2;
  /** 体幹の長さ（腰の中心 → 肩の中心、画素） */
  trunkLength: number;
}

/**
 * 関節の位置から、腰の中心と体幹の長さを求める。
 * 両肩・両腰のどれかが使えない（よく見えない・画面の外）、または体幹の長さが 0 なら null。
 */
export function bodyAnchor(
  landmarks: CommonLandmarks,
  imageSize: ImageSize,
  visibilityThreshold: number = DEFAULT_VISIBILITY_THRESHOLD,
): BodyAnchor | null {
  const { leftShoulder, rightShoulder, leftHip, rightHip } = landmarks;
  const usable = [leftShoulder, rightShoulder, leftHip, rightHip].every((p) =>
    isPointUsable(p, visibilityThreshold, imageSize),
  );
  if (!usable) return null;
  const hipCenter = { x: (leftHip.x + rightHip.x) / 2, y: (leftHip.y + rightHip.y) / 2 };
  const shoulderCenter = {
    x: (leftShoulder.x + rightShoulder.x) / 2,
    y: (leftShoulder.y + rightShoulder.y) / 2,
  };
  const trunkLength = Math.hypot(shoulderCenter.x - hipCenter.x, shoulderCenter.y - hipCenter.y);
  return trunkLength > 0 ? { hipCenter, trunkLength } : null;
}

/** 手がかりを移し替える（左右反転した骨格の手がかりを求めるときなど） */
export function transformAnchor(m: Affine, anchor: BodyAnchor): BodyAnchor {
  // 拡大率は、移し替えで長さが何倍になるか（回転と左右反転では変わらない）
  const scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
  return {
    hipCenter: applyAffine(m, anchor.hipCenter),
    trunkLength: anchor.trunkLength * scale,
  };
}

/**
 * from の骨格を to の骨格に揃える移し替え。
 * 腰の中心まわりに rotateDeg 度まわし（2 つの動画のカメラの傾きの差を打ち消す分）、
 * 体幹の長さが同じになるよう拡大・縮小し、腰の中心を重ねる。
 */
export function alignToAnchor(from: BodyAnchor, to: BodyAnchor, rotateDeg = 0): Affine {
  const rotate = rotationAbout(from.hipCenter, rotateDeg);
  const scale = scalingAbout(from.hipCenter, to.trunkLength / from.trunkLength);
  const move = translation(to.hipCenter.x - from.hipCenter.x, to.hipCenter.y - from.hipCenter.y);
  return composeAffine(move, composeAffine(scale, rotate));
}
