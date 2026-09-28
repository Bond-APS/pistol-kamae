import { METRIC_IDS, METRIC_UNITS, type Handedness } from '@pistol-kamae/engine';
import { useMemo, useState } from 'react';
import { noiseStatsOf } from '../analysis/metrics';
import type { AnalysisResult } from '../analysis/runAnalysis';
import { ja } from '../i18n/ja';

interface Props {
  result: AnalysisResult | null;
  handedness: Handedness;
}

const fmt = (v: number | null, digits: number): string =>
  v === null ? ja.noise.na : v.toFixed(digits);

export function NoiseScreen({ result, handedness }: Props) {
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'failed'>('idle');
  const stats = useMemo(
    () => (result ? noiseStatsOf(result, handedness) : null),
    [result, handedness],
  );

  if (!result || !stats) {
    return (
      <section>
        <h2>{ja.noise.title}</h2>
        <p className="muted">{ja.noise.intro}</p>
        <p>{ja.noise.noResult}</p>
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
          <p className="danger">{ja.noise.copyFailed}</p>
          <textarea readOnly value={text} rows={16} className="textarea" />
        </div>
      )}
    </section>
  );
}
