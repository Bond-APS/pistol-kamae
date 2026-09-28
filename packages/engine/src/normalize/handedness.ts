import type { CommonLandmarks, Point } from '../landmarks/types';

export type Handedness = 'right' | 'left';

/**
 * 銃側／非銃側で表したランドマーク。
 * 角度計算はこの形式だけを見るので、利き手を意識せずに済む。
 *
 * 座標の向きの取り決め：
 * カメラは射手のへそ側（正面）にあるため、右利き射手の銃側（右半身）は画面の左に写る。
 * 左利きの動画は toSided() で x を左右反転し、右利きと同じ見え方に揃える。
 * したがって、この形式では常に「銃側 = 画面左（x が小さい側）」「ターゲット方向 = 画面左」。
 */
export interface SidedLandmarks {
  nose: Point;
  gunEar: Point;
  offEar: Point;
  gunShoulder: Point;
  offShoulder: Point;
  gunHip: Point;
  offHip: Point;
  gunWrist: Point;
  offWrist: Point;
  gunAnkle: Point;
  offAnkle: Point;
}

/** x 座標を画像の幅で左右反転する（表示のときに元へ戻すのにも使う） */
export function mirrorX(landmarks: CommonLandmarks, imageWidth: number): CommonLandmarks {
  const flip = (p: Point): Point => ({ x: imageWidth - p.x, y: p.y, visibility: p.visibility });
  return {
    nose: flip(landmarks.nose),
    // 左右反転すると、射手の左耳は画像上で右耳の位置に来る。名前も入れ替える。
    leftEar: flip(landmarks.rightEar),
    rightEar: flip(landmarks.leftEar),
    leftShoulder: flip(landmarks.rightShoulder),
    rightShoulder: flip(landmarks.leftShoulder),
    leftHip: flip(landmarks.rightHip),
    rightHip: flip(landmarks.leftHip),
    leftWrist: flip(landmarks.rightWrist),
    rightWrist: flip(landmarks.leftWrist),
    leftAnkle: flip(landmarks.rightAnkle),
    rightAnkle: flip(landmarks.leftAnkle),
  };
}

/**
 * 共通ランドマークを銃側／非銃側の形式に変換する。
 * 左利きは x を反転して右利きと同じ扱いにする（CLAUDE.md 5 章）。
 */
export function toSided(
  landmarks: CommonLandmarks,
  handedness: Handedness,
  imageWidth: number,
): SidedLandmarks {
  // 反転後は「射手の右」が銃側になる（左利きの左半身が、右利きの右半身の位置に来る）
  const lm = handedness === 'left' ? mirrorX(landmarks, imageWidth) : landmarks;
  return {
    nose: lm.nose,
    gunEar: lm.rightEar,
    offEar: lm.leftEar,
    gunShoulder: lm.rightShoulder,
    offShoulder: lm.leftShoulder,
    gunHip: lm.rightHip,
    offHip: lm.leftHip,
    gunWrist: lm.rightWrist,
    offWrist: lm.leftWrist,
    gunAnkle: lm.rightAnkle,
    offAnkle: lm.leftAnkle,
  };
}
