import type { CommonLandmarks, Point } from './types';

/** MediaPipe Pose Landmarker の 33 点のうち、共通形式で使う点の番号 */
const MP_INDEX = {
  nose: 0,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftAnkle: 27,
  rightAnkle: 28,
} as const;

/** MediaPipe が返す 1 点（0〜1 の正規化座標） */
export interface MediaPipeLandmark {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

/**
 * MediaPipe の 33 点（正規化座標）を共通形式（画素座標）に変換する。
 * 点数が足りない場合は null を返す。
 */
export function fromMediaPipe(
  landmarks: ReadonlyArray<MediaPipeLandmark>,
  imageWidth: number,
  imageHeight: number,
): CommonLandmarks | null {
  if (landmarks.length < 33) return null;
  const pick = (index: number): Point => {
    const lm = landmarks[index]!;
    return {
      x: lm.x * imageWidth,
      y: lm.y * imageHeight,
      visibility: lm.visibility ?? 0,
    };
  };
  return {
    nose: pick(MP_INDEX.nose),
    leftEar: pick(MP_INDEX.leftEar),
    rightEar: pick(MP_INDEX.rightEar),
    leftShoulder: pick(MP_INDEX.leftShoulder),
    rightShoulder: pick(MP_INDEX.rightShoulder),
    leftHip: pick(MP_INDEX.leftHip),
    rightHip: pick(MP_INDEX.rightHip),
    leftWrist: pick(MP_INDEX.leftWrist),
    rightWrist: pick(MP_INDEX.rightWrist),
    leftAnkle: pick(MP_INDEX.leftAnkle),
    rightAnkle: pick(MP_INDEX.rightAnkle),
  };
}
