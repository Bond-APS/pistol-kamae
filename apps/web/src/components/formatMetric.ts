import {
  METRIC_DECIMALS,
  METRIC_UNITS,
  roundMetric,
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
/** 負の値に全角の「−」を付ける（正は符号なし） */
const minus = (value: number, text: string): string => (value < 0 ? `−${text}` : text);

/**
 * 計測値の表示。角度は符号付き・小数 1 桁に単位（°）、比は小数 2 桁（単位は見出しに書く）。
 * 符号は表示の桁に丸めてから決める（−0.04° が「−0.0°」にならないように。最終-18）
 */
export function formatMetric(id: MetricId, value: number): string {
  const unit = METRIC_UNITS[id];
  const rounded = roundMetric(id, value);
  const abs = Math.abs(rounded).toFixed(METRIC_DECIMALS[unit]);
  return unit === 'deg' ? `${signed(rounded, abs)}${ja.units.deg}` : minus(rounded, abs);
}

/** 差（今回 − 基準）の表示。角度も比も符号を付ける。丸めて 0 なら符号なし */
export function formatDiff(id: MetricId, diff: number): string {
  const unit = METRIC_UNITS[id];
  const rounded = roundMetric(id, diff);
  const abs = Math.abs(rounded).toFixed(METRIC_DECIMALS[unit]);
  const suffix = unit === 'deg' ? ja.units.deg : '';
  return rounded === 0 ? `${abs}${suffix}` : `${signed(rounded, abs)}${suffix}`;
}
