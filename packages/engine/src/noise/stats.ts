import { METRIC_IDS, type MetricId, type MetricValues } from '../metrics/types';

/** 1 つの数列の要約統計 */
export interface SeriesStats {
  /** 有効な（null でない）値の個数 */
  count: number;
  mean: number | null;
  /** 標準偏差（ばらつきの大きさ）。不偏分散の平方根。値が 2 個未満なら null */
  sd: number | null;
  min: number | null;
  max: number | null;
}

export function seriesStats(values: ReadonlyArray<number | null>): SeriesStats {
  const xs = values.filter((v): v is number => v !== null && Number.isFinite(v));
  const count = xs.length;
  if (count === 0) return { count, mean: null, sd: null, min: null, max: null };
  const mean = xs.reduce((s, v) => s + v, 0) / count;
  const sd =
    count >= 2 ? Math.sqrt(xs.reduce((s, v) => s + (v - mean) ** 2, 0) / (count - 1)) : null;
  return { count, mean, sd, min: Math.min(...xs), max: Math.max(...xs) };
}

/** 静止ノイズ測定：計測項目ごとの要約統計（要件 8 章） */
export type NoiseStats = Record<MetricId, SeriesStats>;

export function computeNoiseStats(frames: ReadonlyArray<MetricValues>): NoiseStats {
  const result = {} as NoiseStats;
  for (const id of METRIC_IDS) {
    result[id] = seriesStats(frames.map((f) => f[id]));
  }
  return result;
}
