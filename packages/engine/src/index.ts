// @pistol-kamae/engine の公開窓口。
// UI（apps/web）はここから読み込む。内部ファイルを直接参照しない。
// 注意：姿勢推定バックエンド（MediaPipe）は読み込むだけで大きなライブラリを取り込むため、
// ここからは公開せず、'@pistol-kamae/engine/pose/...' として個別に読み込む。

export const ENGINE_VERSION = '0.1.0';

export {
  LANDMARK_NAMES,
  SKELETON_EDGES,
  type CommonLandmarks,
  type LandmarkFrame,
  type LandmarkName,
  type Point,
} from './landmarks/types';
export { fromMediaPipe, type MediaPipeLandmark } from './landmarks/fromMediaPipe';
export { fromCoco17, type CocoKeypoint } from './landmarks/fromCoco17';

export { mirrorX, toSided, type Handedness, type SidedLandmarks } from './normalize/handedness';

export {
  METRIC_IDS,
  METRIC_UNITS,
  type MetricId,
  type MetricUnit,
  type MetricValues,
} from './metrics/types';
export { computeMetrics, type MetricOptions } from './metrics/compute';

export { computeNoiseStats, seriesStats, type NoiseStats, type SeriesStats } from './noise/stats';

export type { PoseBackend } from './pose/PoseBackend';
