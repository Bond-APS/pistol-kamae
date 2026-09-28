import {
  computeMetrics,
  computeNoiseStats,
  toSided,
  type Handedness,
  type MetricValues,
  type NoiseStats,
} from '@pistol-kamae/engine';
import type { AnalysisResult } from './runAnalysis';

/** 全フレームの計測値（人物未検出のフレームは除く） */
export function metricSeries(result: AnalysisResult, handedness: Handedness): MetricValues[] {
  const series: MetricValues[] = [];
  for (const frame of result.frames) {
    if (!frame.landmarks) continue;
    series.push(computeMetrics(toSided(frame.landmarks, handedness, result.width)));
  }
  return series;
}

export function noiseStatsOf(result: AnalysisResult, handedness: Handedness): NoiseStats {
  return computeNoiseStats(metricSeries(result, handedness));
}
