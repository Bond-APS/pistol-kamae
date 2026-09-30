import {
  METRIC_IDS,
  METRIC_UNITS,
  type FrameMetrics,
  type MetricId,
  type MetricUnit,
} from '@pistol-kamae/engine';
import { ja } from '../i18n/ja';

interface Props {
  metrics: FrameMetrics;
  testId?: string;
}

/** 角度は符号付き・小数 1 桁に単位（°）を付ける。比は小数 2 桁（単位は見出しに書く） */
function formatValue(id: MetricId, value: number): string {
  if (METRIC_UNITS[id] === 'deg') {
    return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}${ja.units.deg}`;
  }
  return value.toFixed(2);
}

const GROUPS: ReadonlyArray<{ unit: MetricUnit; title: string }> = [
  { unit: 'deg', title: ja.metricTable.groupDeg },
  { unit: 'ratio', title: ja.metricTable.groupRatio },
];

/**
 * 1 フレーム分の計測値の表。マーク画面と、ライブラリで開いた記録の両方で使う。
 * 項目は「名称」と「基準・記号」の 2 行、値は右寄せ。計測できない項目は「—」とグレー。
 */
export function MetricTable({ metrics, testId }: Props) {
  return (
    <>
      <p className="muted small">{ja.metricTable.signNote}</p>
      {!metrics.values && <p className="danger small">{ja.metricTable.noPerson}</p>}
      <table className="metric-table" data-testid={testId} data-frame-index={metrics.frameIndex}>
        {GROUPS.map((group) => (
          <tbody key={group.unit}>
            <tr>
              <th colSpan={2} scope="colgroup">
                {group.title}
              </th>
            </tr>
            {METRIC_IDS.filter((id) => METRIC_UNITS[id] === group.unit).map((id) => {
              const value = metrics.values?.[id] ?? null;
              return (
                <tr
                  key={id}
                  className={value === null ? 'unavailable' : undefined}
                  data-metric={id}
                  data-value={value ?? ''}
                >
                  <td>
                    {ja.metricNames[id]}
                    <small>{ja.metricBasis[id]}</small>
                  </td>
                  <td className="value">
                    {value === null ? ja.metricTable.na : formatValue(id, value)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
      <p className="muted small">{ja.metricTable.legend}</p>
    </>
  );
}
