import type { Point } from '../landmarks/types';
import { DEFAULT_VISIBILITY_THRESHOLD, isPointUsable, type ImageSize } from '../landmarks/usable';
import type { SidedLandmarks } from '../normalize/handedness';
import type { MetricValues } from './types';

export interface MetricOptions {
  /** この値未満の visibility の点は計測から外す（既定 0.5） */
  visibilityThreshold?: number;
  /** 動画の大きさ。渡すと、画面の外にある点も計測から外す */
  imageSize?: ImageSize;
}

const toDeg = (rad: number): number => (rad * 180) / Math.PI;

const midpoint = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
  visibility: Math.min(a.visibility, b.visibility),
});

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * 全計測項目を 1 フレーム分計算する。
 *
 * 符号の取り決め（要件 6.3）：銃側へ傾く・上がる＝正。
 * 座標は toSided() 済みで、銃側・ターゲット方向は画面左（x が小さい側）、y は下向きが正。
 */
export function computeMetrics(lm: SidedLandmarks, options: MetricOptions = {}): MetricValues {
  const th = options.visibilityThreshold ?? DEFAULT_VISIBILITY_THRESHOLD;
  const usable = (p: Point): boolean => isPointUsable(p, th, options.imageSize);
  const ok = (...points: Point[]): boolean => points.every(usable);

  const shoulderCenter = midpoint(lm.gunShoulder, lm.offShoulder);
  const hipCenter = midpoint(lm.gunHip, lm.offHip);
  const ankleCenter = midpoint(lm.gunAnkle, lm.offAnkle);
  // 顔：銃側の耳。見えなければ鼻で代替（要件 6.1）
  const face = usable(lm.gunEar) ? lm.gunEar : lm.nose;

  const trunkOk = ok(lm.gunShoulder, lm.offShoulder, lm.gunHip, lm.offHip);
  const trunkLength = trunkOk ? distance(hipCenter, shoulderCenter) : null;
  const trunkUsable = trunkLength !== null && trunkLength > 0;

  // 水平基準の傾き：非銃側 → 銃側 のベクトル。銃側が上（y が小さい）なら正。
  const tiltFromHorizontal = (off: Point, gun: Point): number =>
    toDeg(Math.atan2(off.y - gun.y, off.x - gun.x));

  // 鉛直基準の傾き：下の点 → 上の点 のベクトル。上の点が銃側（x が小さい）に寄れば正。
  const tiltFromVertical = (lower: Point, upper: Point): number =>
    toDeg(Math.atan2(lower.x - upper.x, lower.y - upper.y));

  const shoulderTilt = ok(lm.gunShoulder, lm.offShoulder)
    ? tiltFromHorizontal(lm.offShoulder, lm.gunShoulder)
    : null;

  const hipTilt = ok(lm.gunHip, lm.offHip) ? tiltFromHorizontal(lm.offHip, lm.gunHip) : null;

  const trunkTilt = trunkOk ? tiltFromVertical(hipCenter, shoulderCenter) : null;

  const neckTilt =
    ok(lm.gunShoulder, lm.offShoulder) && usable(face)
      ? tiltFromVertical(shoulderCenter, face)
      : null;

  // 腕の挙上角：銃側肩 → 銃側手首。手首がターゲット方向（画面左）へ伸び、上がるほど正。
  const armElevation = ok(lm.gunShoulder, lm.gunWrist)
    ? tiltFromHorizontal(lm.gunShoulder, lm.gunWrist)
    : null;

  // 腕と肩線のなす角：どちらも「ターゲット方向」を向いた線なので、差がそのまま身体基準の角度になる
  const armShoulderAngle =
    armElevation !== null && shoulderTilt !== null ? armElevation - shoulderTilt : null;

  const hipLateralOffset =
    trunkUsable && ok(lm.gunAnkle, lm.offAnkle)
      ? (ankleCenter.x - hipCenter.x) / trunkLength
      : null;

  const stanceWidth =
    trunkUsable && ok(lm.gunAnkle, lm.offAnkle)
      ? distance(lm.gunAnkle, lm.offAnkle) / trunkLength
      : null;

  const wristFaceDistance =
    trunkUsable && ok(lm.gunWrist) && usable(face) ? (face.x - lm.gunWrist.x) / trunkLength : null;

  return {
    shoulderTilt,
    hipTilt,
    trunkTilt,
    neckTilt,
    armElevation,
    armShoulderAngle,
    hipLateralOffset,
    stanceWidth,
    wristFaceDistance,
  };
}
