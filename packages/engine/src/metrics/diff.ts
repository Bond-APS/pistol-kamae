// 2 つの記録（基準と今回）の計測値の差と、その差が測定の揺れを超えているかの判定（要件 7 章・8 章）。

import {
  METRIC_DECIMALS,
  METRIC_IDS,
  METRIC_UNITS,
  type MetricId,
  type MetricValues,
} from './types';

/**
 * 差の大きさの区分。
 * none：測定の揺れと区別できない、notable：やや差がある（黄）、large：差がある（赤）
 */
export type DiffLevel = 'none' | 'notable' | 'large';

export interface MetricDiff {
  /** 基準の値（表示の桁に丸めたもの）。計測できなければ null */
  base: number | null;
  /** 今回の値（表示の桁に丸めたもの）。計測できなければ null */
  current: number | null;
  /** 今回 − 基準。どちらかが計測できなければ null */
  diff: number | null;
  level: DiffLevel;
}

/**
 * 測定の揺れの幅（同じ姿勢でも、1 フレームの値がこのくらいばらつく）の既定値。
 * ユーザー候補の動画 6 本の据銃区間で測った標準偏差の最大値（角度 0.10〜0.40°、比 0.004〜0.011）を丸めたもの。
 * 水平・鉛直基準の角度は、水平の線を指で引く精度（0.2〜0.3° 程度）も考えて 0.3° に揃えている。
 */
export const DEFAULT_NOISE_WIDTHS: Record<MetricId, number> = {
  shoulderTilt: 0.3,
  hipTilt: 0.3,
  trunkTilt: 0.3,
  neckTilt: 0.3,
  armElevation: 0.3,
  armShoulderAngle: 0.4,
  hipLateralOffset: 0.01,
  stanceWidth: 0.01,
  wristFaceDistance: 0.01,
};

/**
 * 揺れの幅の何倍から色を付けるか。
 * 差は 2 つの測定値の引き算なので、揺れは約 1.4 倍になる。1 倍で色を付けると、姿勢が同じでも
 * 約半分の項目に色が付いてしまうため、2 倍（偶然で付くのは約 16%）と 3 倍（約 3%）にしている。
 */
export const DEFAULT_DIFF_FACTORS = { notable: 2, large: 3 } as const;

export interface DiffOptions {
  noiseWidths?: Record<MetricId, number>;
  factors?: { notable: number; large: number };
}

/** 表示の桁（角度は小数 1 桁、比は小数 2 桁）に丸める */
export function roundMetric(id: MetricId, value: number): number {
  const scale = 10 ** METRIC_DECIMALS[METRIC_UNITS[id]];
  // −0 を 0 に直す（表示で「−0.0」にならないように）
  return Math.round(value * scale) / scale + 0;
}

/**
 * 基準と今回の差を項目ごとに求める。
 * 表に出る数字どうしで引き算が合うよう、値を表示の桁に丸めてから差を取る
 * （丸める前の差を出すと、「13.1 − 12.4」が「0.6」と表示されることがある）。
 * 区分も、丸めた差が「揺れの幅 × 倍数」以上かどうかで決める。
 */
export function compareMetrics(
  base: MetricValues,
  current: MetricValues,
  options: DiffOptions = {},
): Record<MetricId, MetricDiff> {
  const widths = options.noiseWidths ?? DEFAULT_NOISE_WIDTHS;
  const factors = options.factors ?? DEFAULT_DIFF_FACTORS;
  // 0.6 と 0.3 × 2 のような比較で、浮動小数点の丸めの分だけ届かないことがないようにする
  const EPSILON = 1e-9;
  const out = {} as Record<MetricId, MetricDiff>;
  for (const id of METRIC_IDS) {
    const b = base[id] === null ? null : roundMetric(id, base[id]);
    const c = current[id] === null ? null : roundMetric(id, current[id]);
    const diff = b === null || c === null ? null : roundMetric(id, c - b);
    let level: DiffLevel = 'none';
    if (diff !== null) {
      const size = Math.abs(diff) + EPSILON;
      if (size >= widths[id] * factors.large) level = 'large';
      else if (size >= widths[id] * factors.notable) level = 'notable';
    }
    out[id] = { base: b, current: c, diff, level };
  }
  return out;
}
