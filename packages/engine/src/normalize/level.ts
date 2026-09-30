// 水平校正（要件 6.3）。
// 静止画の上に、本当は水平なもの（床と壁の境目など）か、本当は鉛直なもの（柱・ドア枠など）に沿って
// 線を 1 本引いてもらい、その線の傾きをカメラの傾きとみなして、関節の位置を逆向きに回してから角度を計算する。
// 三脚の傾きが日によって違っても、角度を比べられるようにするため。

import { LANDMARK_NAMES, type CommonLandmarks, type Point } from '../landmarks/types';
import type { ImageSize } from '../landmarks/usable';
import { applyAffine, rotationAbout } from './affine';

/** 水平校正の線。元の動画の画素座標で、両端の 2 点 */
export interface LevelLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** 線をどちらの基準として扱ったか。水平から 45° 以内なら水平、それより立っていれば鉛直 */
export type LevelKind = 'horizontal' | 'vertical';

export interface LevelInfo {
  kind: LevelKind;
  /**
   * カメラの傾き（度）。水平なものが画面上でどれだけ傾いて写っているか。
   * 正＝右下がりに写っている（画面が時計回りに回って写っている）、負＝右上がり。
   */
  tiltDeg: number;
  /** 線の長さ（画素） */
  length: number;
}

/** これを超える傾きは、水平・鉛直でないものに線を引いた疑いが強いので受け付けない */
export const LEVEL_MAX_TILT_DEG = 10;
/** 線の長さの下限。画像の長い辺に対する割合（短い線は、端の位置の少しのずれで角度が大きく変わる） */
export const LEVEL_MIN_LENGTH_RATIO = 0.2;

/** 線の傾きからカメラの傾きを求める。長さ 0 の線は null */
export function levelInfo(line: LevelLine): LevelInfo | null {
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return null;
  // 線の向き（どちらの端から測っても同じになるよう −90°〜＋90° に直す）
  let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (deg > 90) deg -= 180;
  if (deg <= -90) deg += 180;
  if (Math.abs(deg) <= 45) return { kind: 'horizontal', tiltDeg: deg, length };
  // 鉛直の線：鉛直からのずれがカメラの傾き
  return { kind: 'vertical', tiltDeg: deg > 0 ? deg - 90 : deg + 90, length };
}

export type LevelProblem = 'tooShort' | 'tooTilted';

/** 線を水平校正に使ってよいか。問題がなければ null */
export function checkLevelLine(line: LevelLine, imageSize: ImageSize): LevelProblem | null {
  const info = levelInfo(line);
  const minLength = Math.max(imageSize.width, imageSize.height) * LEVEL_MIN_LENGTH_RATIO;
  if (!info || info.length < minLength) return 'tooShort';
  if (Math.abs(info.tiltDeg) > LEVEL_MAX_TILT_DEG) return 'tooTilted';
  return null;
}

/** 線から求めたカメラの傾き（度）。線がない・使えない線なら 0（補正しない） */
export function levelTiltDeg(line: LevelLine | null, imageSize: ImageSize): number {
  if (!line || checkLevelLine(line, imageSize) !== null) return 0;
  return levelInfo(line)?.tiltDeg ?? 0;
}

/**
 * カメラの傾きを打ち消すように、関節の位置を画像の中心まわりに回す。
 * 画面の外にある点は、回したあとでは画面の内外を正しく判定できなくなるので、
 * 先に visibility を 0 にして計測から外れるようにする（回したあとの座標で画面の内外を調べないこと）。
 */
export function applyLevel(
  landmarks: CommonLandmarks,
  tiltDeg: number,
  imageSize: ImageSize,
): CommonLandmarks {
  const rotate = rotationAbout({ x: imageSize.width / 2, y: imageSize.height / 2 }, -tiltDeg);
  const inside = (p: Point): boolean =>
    p.x >= 0 && p.x <= imageSize.width && p.y >= 0 && p.y <= imageSize.height;
  const out = {} as CommonLandmarks;
  for (const name of LANDMARK_NAMES) {
    const p = landmarks[name];
    out[name] = applyAffine(rotate, inside(p) ? p : { ...p, visibility: 0 });
  }
  return out;
}
