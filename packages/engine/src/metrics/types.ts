/**
 * 計測項目の一覧（要件 6.2 章）。
 * 表示名は UI 側（i18n）が持つ。engine は記号・単位・基準だけを持つ。
 */
export const METRIC_IDS = [
  'shoulderTilt', // (a) 肩線の傾き（水平基準）
  'hipTilt', // (b) 腰線の傾き（水平基準）
  'trunkTilt', // (c) 体軸の傾き（鉛直基準）
  'neckTilt', // (d) 首の傾き（鉛直基準）
  'armElevation', // (f) 腕の挙上角（水平基準）
  'armShoulderAngle', // (g) 腕と肩線のなす角（身体基準）
  'hipLateralOffset', // (h) 腰中心の横ずれ（体幹長比）
  'stanceWidth', // (i) スタンス幅（体幹長比）
  'wristFaceDistance', // (j) 手首と顔の水平距離（体幹長比）
] as const;

export type MetricId = (typeof METRIC_IDS)[number];

export type MetricUnit = 'deg' | 'ratio';

export const METRIC_UNITS: Record<MetricId, MetricUnit> = {
  shoulderTilt: 'deg',
  hipTilt: 'deg',
  trunkTilt: 'deg',
  neckTilt: 'deg',
  armElevation: 'deg',
  armShoulderAngle: 'deg',
  hipLateralOffset: 'ratio',
  stanceWidth: 'ratio',
  wristFaceDistance: 'ratio',
};

/** 表示するときの小数の桁数（角度は 0.1° 刻み、比は 0.01 刻み） */
export const METRIC_DECIMALS: Record<MetricUnit, number> = { deg: 1, ratio: 2 };

/** 1 フレーム分の計測値。visibility 不足などで計測できない項目は null。 */
export type MetricValues = Record<MetricId, number | null>;
