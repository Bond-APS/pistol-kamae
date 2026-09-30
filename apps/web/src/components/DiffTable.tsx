import {
  DEFAULT_DIFF_FACTORS,
  METRIC_IDS,
  METRIC_UNITS,
  type MetricDiff,
  type MetricId,
} from '@pistol-kamae/engine';
import { ja } from '../i18n/ja';
import { METRIC_GROUPS, formatDiff, formatMetric } from './formatMetric';

interface Props {
  /** 項目ごとの基準・今回・差（engine の compareMetrics の結果） */
  diffs: Record<MetricId, MetricDiff>;
  testId?: string;
}

/**
 * 基準・今回・差の 3 列の表（要件 7 章）。
 * 差が測定の揺れを超えた項目だけ色を付ける。色だけに頼らないよう、◇（やや差がある）◆（差がある）の印も付ける。
 */
export function DiffTable({ diffs, testId }: Props) {
  const value = (id: MetricId, v: number | null) =>
    v === null ? ja.metricTable.na : formatMetric(id, v);
  return (
    <>
      <p className="muted small">{ja.compare.signNote}</p>
      <table className="diff-table" data-testid={testId}>
        {METRIC_GROUPS.map((group) => (
          <tbody key={group.unit}>
            <tr>
              <th scope="col">{group.title}</th>
              <th scope="col">{ja.compare.colBase}</th>
              <th scope="col">{ja.compare.colCurrent}</th>
              <th scope="col">{ja.compare.colDiff}</th>
            </tr>
            {METRIC_IDS.filter((id) => METRIC_UNITS[id] === group.unit).map((id) => {
              const d = diffs[id];
              return (
                <tr
                  key={id}
                  className={d.diff === null ? 'unavailable' : undefined}
                  data-metric={id}
                  data-base={d.base ?? ''}
                  data-current={d.current ?? ''}
                  data-diff={d.diff ?? ''}
                  data-level={d.level}
                >
                  <td>
                    {ja.metricNames[id]}
                    <small>{ja.metricBasis[id]}</small>
                  </td>
                  <td className="value">{value(id, d.base)}</td>
                  <td className="value">{value(id, d.current)}</td>
                  <td className={`diff ${d.level}`}>
                    {d.level === 'notable' && (
                      <span aria-label={ja.compare.ariaNotable}>{ja.compare.markNotable} </span>
                    )}
                    {d.level === 'large' && (
                      <span aria-label={ja.compare.ariaLarge}>{ja.compare.markLarge} </span>
                    )}
                    {d.diff === null ? ja.metricTable.na : formatDiff(id, d.diff)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
      <p className="muted small">
        {ja.compare.legend(DEFAULT_DIFF_FACTORS.notable, DEFAULT_DIFF_FACTORS.large)}
        <br />
        {ja.compare.legendNone}
      </p>
    </>
  );
}
