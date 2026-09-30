import {
  METRIC_DECIMALS,
  METRIC_UNITS,
  type MetricId,
  type MetricUnit,
} from '@pistol-kamae/engine';
import { ja } from '../i18n/ja';

/** 表のまとまり：角度の項目と、体幹長に対する比の項目 */
export const METRIC_GROUPS: ReadonlyArray<{ unit: MetricUnit; title: string }> = [
  { unit: 'deg', title: ja.metricTable.groupDeg },
  { unit: 'ratio', title: ja.metricTable.groupRatio },
];

const signed = (value: number, text: string): string => `${value >= 0 ? '+' : '−'}${text}`;

/** 計測値の表示。角度は符号付き・小数 1 桁に単位（°）、比は小数 2 桁（単位は見出しに書く） */
export function formatMetric(id: MetricId, value: number): string {
  const unit = METRIC_UNITS[id];
  if (unit === 'deg') {
    return `${signed(value, Math.abs(value).toFixed(METRIC_DECIMALS.deg))}${ja.units.deg}`;
  }
  return value.toFixed(METRIC_DECIMALS.ratio);
}

/** 差（今回 − 基準）の表示。角度も比も符号を付ける。差がちょうど 0 なら符号なし */
export function formatDiff(id: MetricId, diff: number): string {
  const unit = METRIC_UNITS[id];
  const abs = Math.abs(diff).toFixed(METRIC_DECIMALS[unit]);
  const suffix = unit === 'deg' ? ja.units.deg : '';
  return diff === 0 ? `${abs}${suffix}` : `${signed(diff, abs)}${suffix}`;
}
