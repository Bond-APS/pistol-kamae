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
  IDENTITY,
  applyAffine,
  composeAffine,
  mirroringX,
  rotationAbout,
  scalingAbout,
  translation,
  type Affine,
  type Vec2,
} from './normalize/affine';
export {
  LEVEL_MAX_TILT_DEG,
  LEVEL_MIN_LENGTH_RATIO,
  applyLevel,
  checkLevelLine,
  levelInfo,
  levelTiltDeg,
  type LevelInfo,
  type LevelKind,
  type LevelLine,
  type LevelProblem,
} from './normalize/level';
export { alignToAnchor, bodyAnchor, transformAnchor, type BodyAnchor } from './normalize/align';

export {
  METRIC_DECIMALS,
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

export {
  DEFAULT_DIFF_FACTORS,
  DEFAULT_NOISE_WIDTHS,
  compareMetrics,
  roundMetric,
  type DiffLevel,
  type DiffOptions,
  type MetricDiff,
} from './metrics/diff';

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

export {
  coverRect,
  expandRect,
  padRect,
  personBounds,
  transformedBounds,
  unionRect,
  type Rect,
} from './landmarks/bounds';

export {
  RECORD_FORMAT_VERSION,
  type RecordAnalysis,
  type RecordMeta,
  type ShotRecord,
} from './record/types';
export {
  checkClip,
  clipContains,
  clipDurationSec,
  clipOf,
  commonWindow,
  shotWindow,
  type Clip,
  type ClipProblem,
  type ShotWindow,
} from './record/clip';
export {
  MEMO_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  defaultTitle,
  normalizeMemo,
  normalizeTitle,
} from './record/title';
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
export {
  checkShotRecord,
  hasUsableLevel,
  shotMetricsOfRecord,
  tiltDegOfRecord,
  upgradeShotRecord,
  type RecordProblem,
} from './record/validate';

export type { PoseBackend } from './pose/PoseBackend';
