import {
  computeMetrics,
  computeNoiseStats,
  toSided,
  type Handedness,
  type MetricValues,
  type NoiseStats,
} from '@pistol-kamae/engine';
import type { AnalysisResult } from './runAnalysis';

/** 集計対象の時間範囲（秒）。省略すれば全フレーム */
export interface TimeRange {
  startSec: number;
  endSec: number;
}

/** 範囲内の計測値（人物未検出のフレームは除く） */
export function metricSeries(
  result: AnalysisResult,
  handedness: Handedness,
  range?: TimeRange,
): MetricValues[] {
  const series: MetricValues[] = [];
  for (const frame of result.frames) {
    if (!frame.landmarks) continue;
    if (range && (frame.timeSec < range.startSec || frame.timeSec > range.endSec)) continue;
    series.push(computeMetrics(toSided(frame.landmarks, handedness, result.width)));
  }
  return series;
}

export function noiseStatsOf(
  result: AnalysisResult,
  handedness: Handedness,
  range?: TimeRange,
): NoiseStats {
  return computeNoiseStats(metricSeries(result, handedness, range));
}
