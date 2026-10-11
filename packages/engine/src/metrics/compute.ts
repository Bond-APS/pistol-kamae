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

/** 角度を −180〜180° に折り返す（2 つの角度の差は ±360° まで出るため） */
export const wrapDeg = (deg: number): number => ((((deg + 180) % 360) + 360) % 360) - 180;

/**
 * 左右が逆（鏡像・背面からの撮影・利き手の設定違い）か。
 * 反転後の座標では銃側が画面左（x が小さい側）のはずなので、銃側の肩が非銃側より右にあれば逆とみなす。
 * 肩が見えなければ判断しない（false）
 */
export function isSideReversed(lm: SidedLandmarks, options: MetricOptions = {}): boolean {
  const th = options.visibilityThreshold ?? DEFAULT_VISIBILITY_THRESHOLD;
  const usable = (p: Point): boolean => isPointUsable(p, th, options.imageSize);
  return usable(lm.gunShoulder) && usable(lm.offShoulder) && lm.gunShoulder.x > lm.offShoulder.x;
}

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
  // 顔：カメラに見える非銃側の耳（へそ側から撮ると頭はターゲット方向を向くので、カメラ側に来るのは非銃側の耳。
  // 2026-10-08、開発者の説明で「銃側の耳」から訂正）。見えなければ鼻で代替（要件 6.1。2026-10-10、開発者の決定）
  const face = usable(lm.offEar) ? lm.offEar : lm.nose;

  const trunkOk = ok(lm.gunShoulder, lm.offShoulder, lm.gunHip, lm.offHip);
  const trunkLength = trunkOk ? distance(hipCenter, shoulderCenter) : null;
  const trunkUsable = trunkLength !== null && trunkLength > 0;
  // 左右が逆（鏡像・背面・利き手の設定違い）なら、符号の付く項目は意味を持たないので「—」にする（最終-12）。
  // スタンス幅（向きによらない）だけは出す
  const reversed = isSideReversed(lm, options);
  const sided = (value: number | null): number | null => (reversed ? null : value);

  // 水平基準の傾き：非銃側 → 銃側 のベクトル。銃側が上（y が小さい）なら正。2 点が一致していれば null（最終-13）
  const tiltFromHorizontal = (off: Point, gun: Point): number | null =>
    distance(off, gun) > 0 ? toDeg(Math.atan2(off.y - gun.y, off.x - gun.x)) : null;

  // 鉛直基準の傾き：下の点 → 上の点 のベクトル。上の点が銃側（x が小さい）に寄れば正。
  const tiltFromVertical = (lower: Point, upper: Point): number | null =>
    distance(lower, upper) > 0 ? toDeg(Math.atan2(lower.x - upper.x, lower.y - upper.y)) : null;

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

  // 腕と肩線のなす角：どちらも「ターゲット方向」を向いた線なので、差がそのまま身体基準の角度になる。
  // 差は ±360° まで出るので −180〜180° に折り返す
  const armShoulderAngle =
    armElevation !== null && shoulderTilt !== null ? wrapDeg(armElevation - shoulderTilt) : null;

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
    shoulderTilt: sided(shoulderTilt),
    hipTilt: sided(hipTilt),
    trunkTilt: sided(trunkTilt),
    neckTilt: sided(neckTilt),
    armElevation: sided(armElevation),
    armShoulderAngle: sided(armShoulderAngle),
    hipLateralOffset: sided(hipLateralOffset),
    stanceWidth,
    wristFaceDistance: sided(wristFaceDistance),
  };
}
