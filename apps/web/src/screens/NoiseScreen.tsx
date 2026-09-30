import { METRIC_IDS, METRIC_UNITS, type Handedness } from '@pistol-kamae/engine';
import { useMemo, useState } from 'react';
import { noiseStatsOf, type TimeRange } from '../analysis/metrics';
import type { AnalysisResult } from '../analysis/runAnalysis';
import { ja } from '../i18n/ja';

interface Props {
  result: AnalysisResult | null;
  handedness: Handedness;
  onGoLoad: () => void;
}

const fmt = (v: number | null, digits: number): string =>
  v === null ? ja.noise.na : v.toFixed(digits);

// 区間指定は開発サーバ（npm run dev）でのみ表示する検証用の機能。公開ビルドには含めない。
const DEV_RANGE_ENABLED = import.meta.env.DEV;

export function NoiseScreen({ result, handedness, onGoLoad }: Props) {
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'failed'>('idle');
  const [rangeText, setRangeText] = useState({ start: '', end: '' });
  const range = useMemo((): TimeRange | undefined => {
    if (!DEV_RANGE_ENABLED) return undefined;
    const start = Number(rangeText.start);
    const end = Number(rangeText.end);
    if (rangeText.start === '' && rangeText.end === '') return undefined;
    return {
      startSec: Number.isFinite(start) ? start : 0,
      endSec: rangeText.end === '' || !Number.isFinite(end) ? Infinity : end,
    };
  }, [rangeText]);
  const stats = useMemo(
    () => (result ? noiseStatsOf(result, handedness, range) : null),
    [result, handedness, range],
  );

  if (!result || !stats) {
    return (
      <section>
        <h2>{ja.noise.title}</h2>
        <p className="muted">{ja.noise.intro}</p>
        <p>{ja.noise.noResult}</p>
        <button onClick={onGoLoad}>{ja.common.goLoad}</button>
      </section>
    );
  }

  const frames = result.frames.length;
  const detected = result.frames.filter((f) => f.landmarks).length;
  const totalSec = result.timing.totalMs / 1000;
  const perFrame = (ms: number) => (frames > 0 ? ms / frames : 0);
  const speedText = ja.noise.speed(
    frames,
    totalSec,
    frames / totalSec,
    perFrame(result.timing.inferenceMs),
    perFrame(result.timing.seekMs),
  );

  const rows = METRIC_IDS.map((id) => {
    const s = stats[id];
    const digits = METRIC_UNITS[id] === 'deg' ? 2 : 3;
    return {
      id,
      label: ja.metrics[id],
      unit: ja.units[METRIC_UNITS[id]],
      count: s.count,
      mean: fmt(s.mean, digits),
      sd: fmt(s.sd, digits),
      range: s.min === null ? ja.noise.na : `${fmt(s.min, digits)} 〜 ${fmt(s.max, digits)}`,
    };
  });

  const text = [
    `backend: ${result.backendId}`,
    `video: ${result.width}x${result.height}, ${result.durationSec.toFixed(2)} s, ${result.fps.toFixed(2)} fps`,
    `handedness: ${handedness}`,
    `userAgent: ${navigator.userAgent}`,
    speedText,
    ja.noise.detected(detected, frames),
    range ? ja.noise.rangeLabel(range.startSec, range.endSec) : '',
    '',
    [
      ja.noise.columns.metric,
      ja.noise.columns.unit,
      ja.noise.columns.count,
      ja.noise.columns.mean,
      ja.noise.columns.sd,
      ja.noise.columns.range,
    ].join('\t'),
    ...rows.map((r) => [r.label, r.unit, r.count, r.mean, r.sd, r.range].join('\t')),
  ].join('\n');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('ok');
    } catch {
      setCopyState('failed');
    }
  };

  return (
    <section>
      <h2>{ja.noise.title}</h2>
      <p className="muted small">{ja.noise.intro}</p>
      <p className="muted small">{ja.noise.passLine}</p>

      <h3>{ja.noise.speedTitle}</h3>
      <p>{speedText}</p>
      <p className="muted small">{ja.noise.detected(detected, frames)}</p>

      {DEV_RANGE_ENABLED && (
        <div className="row">
          <label className="field">
            <span>{ja.noise.rangeStart}</span>
            <input
              type="number"
              step="0.1"
              min="0"
              value={rangeText.start}
              onChange={(e) => setRangeText({ ...rangeText, start: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{ja.noise.rangeEnd}</span>
            <input
              type="number"
              step="0.1"
              min="0"
              value={rangeText.end}
              onChange={(e) => setRangeText({ ...rangeText, end: e.target.value })}
            />
          </label>
          <span className="muted small">{ja.noise.rangeDevNote}</span>
        </div>
      )}

      <table className="table">
        <thead>
          <tr>
            <th>{ja.noise.columns.metric}</th>
            <th>{ja.noise.columns.unit}</th>
            <th>{ja.noise.columns.count}</th>
            <th>{ja.noise.columns.mean}</th>
            <th>{ja.noise.columns.sd}</th>
            <th>{ja.noise.columns.range}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.label}</td>
              <td>{r.unit}</td>
              <td className="num">{r.count}</td>
              <td className="num">{r.mean}</td>
              <td className="num">{r.sd}</td>
              <td className="num">{r.range}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="row">
        <button onClick={() => void copy()}>{ja.noise.copy}</button>
        {copyState === 'ok' && <span className="muted">{ja.noise.copied}</span>}
      </div>
      {copyState === 'failed' && (
        <div>
          <div className="notice err">
            <strong>{ja.noise.copyFailed}</strong>
          </div>
          <textarea readOnly value={text} rows={16} className="textarea" />
        </div>
      )}
    </section>
  );
}
