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
export { DEFAULT_VISIBILITY_THRESHOLD, isPointUsable, type ImageSize } from './landmarks/usable';

export { mirrorX, toSided, type Handedness, type SidedLandmarks } from './normalize/handedness';

export {
  METRIC_IDS,
  METRIC_UNITS,
  type MetricId,
  type MetricUnit,
  type MetricValues,
} from './metrics/types';
export { computeMetrics, type MetricOptions } from './metrics/compute';
export {
  metricsAtFrame,
  metricsAtTime,
  type FrameMetrics,
  type FrameMetricsInput,
} from './metrics/atFrame';

export { frameIndexAt } from './landmarks/frames';

export { SHOT_MARK_ID, type Mark, type MarkKind } from './marks/types';
export {
  addCustomMark,
  hasCustomMarkLabel,
  nextMarkId,
  normalizeMarkLabel,
  removeMark,
  setShotMark,
  shotMarkOf,
} from './marks/operations';

export { computeNoiseStats, seriesStats, type NoiseStats, type SeriesStats } from './noise/stats';

export { coverRect, expandRect, personBounds, type Rect } from './landmarks/bounds';

export {
  RECORD_FORMAT_VERSION,
  type RecordAnalysis,
  type RecordMeta,
  type ShotRecord,
} from './record/types';
export {
  SCORE_MAX,
  SCORE_MIN,
  formatScore,
  isValidScore,
  parseScore,
  type ScoreParseResult,
} from './record/score';
export {
  normalizeLocalDateTime,
  parseLocalDateTime,
  toLocalDateTime,
  type LocalDateTime,
} from './record/dateTime';
export {
  SHOOTER_NAME_MAX_LENGTH,
  hasShooterName,
  normalizeShooterName,
  type Shooter,
} from './record/shooter';
export { checkShotRecord, shotMetricsOfRecord, type RecordProblem } from './record/validate';

export type { PoseBackend } from './pose/PoseBackend';
