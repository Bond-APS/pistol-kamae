// 共通ランドマーク形式。
// どの姿勢推定モデルの出力も、まずこの形式に変換してから角度計算に渡す。
// 座標は画素単位（x は右向き、y は下向きが正）。visibility は 0〜1（1 が最もよく見えている）。

export interface Point {
  x: number;
  y: number;
  visibility: number;
}

export const LANDMARK_NAMES = [
  'nose',
  'leftEar',
  'rightEar',
  'leftShoulder',
  'rightShoulder',
  'leftHip',
  'rightHip',
  'leftWrist',
  'rightWrist',
  'leftAnkle',
  'rightAnkle',
] as const;

export type LandmarkName = (typeof LANDMARK_NAMES)[number];

/** 1 フレーム分の共通ランドマーク。left/right は射手自身の左右（画像の左右ではない）。 */
export type CommonLandmarks = Record<LandmarkName, Point>;

/** 動画 1 フレームの推定結果。人物が検出できなかったフレームは landmarks が null。 */
export interface LandmarkFrame {
  /** 動画の媒体時刻（秒） */
  timeSec: number;
  landmarks: CommonLandmarks | null;
}

/** 骨格を線で結ぶときの組み合わせ（描画用） */
export const SKELETON_EDGES: ReadonlyArray<readonly [LandmarkName, LandmarkName]> = [
  ['leftShoulder', 'rightShoulder'],
  ['leftHip', 'rightHip'],
  ['leftShoulder', 'leftHip'],
  ['rightShoulder', 'rightHip'],
  ['leftShoulder', 'leftWrist'],
  ['rightShoulder', 'rightWrist'],
  ['leftHip', 'leftAnkle'],
  ['rightHip', 'rightAnkle'],
  ['nose', 'leftEar'],
  ['nose', 'rightEar'],
];
