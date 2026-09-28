import type { CommonLandmarks, Point } from './types';

/** COCO 形式 17 点（MoveNet・RTMPose・ViTPose など）の番号 */
const COCO_INDEX = {
  nose: 0,
  leftEar: 3,
  rightEar: 4,
  leftShoulder: 5,
  rightShoulder: 6,
  leftWrist: 9,
  rightWrist: 10,
  leftHip: 11,
  rightHip: 12,
  leftAnkle: 15,
  rightAnkle: 16,
} as const;

/** TensorFlow.js pose-detection が返す 1 点（画素座標、score が visibility 相当） */
export interface CocoKeypoint {
  x: number;
  y: number;
  score?: number;
  name?: string;
}

/**
 * COCO 形式 17 点（画素座標）を共通形式に変換する。
 * MoveNet は画素座標で返すため、座標の変換はしない。
 */
export function fromCoco17(keypoints: ReadonlyArray<CocoKeypoint>): CommonLandmarks | null {
  if (keypoints.length < 17) return null;
  const pick = (index: number): Point => {
    const kp = keypoints[index]!;
    return { x: kp.x, y: kp.y, visibility: kp.score ?? 0 };
  };
  return {
    nose: pick(COCO_INDEX.nose),
    leftEar: pick(COCO_INDEX.leftEar),
    rightEar: pick(COCO_INDEX.rightEar),
    leftShoulder: pick(COCO_INDEX.leftShoulder),
    rightShoulder: pick(COCO_INDEX.rightShoulder),
    leftHip: pick(COCO_INDEX.leftHip),
    rightHip: pick(COCO_INDEX.rightHip),
    leftWrist: pick(COCO_INDEX.leftWrist),
    rightWrist: pick(COCO_INDEX.rightWrist),
    leftAnkle: pick(COCO_INDEX.leftAnkle),
    rightAnkle: pick(COCO_INDEX.rightAnkle),
  };
}
