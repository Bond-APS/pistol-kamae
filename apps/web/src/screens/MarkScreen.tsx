import {
  METRIC_IDS,
  METRIC_UNITS,
  addCustomMark,
  frameIndexAt,
  metricsAtTime,
  nextMarkId,
  normalizeMarkLabel,
  removeMark,
  setShotMark,
  shotMarkOf,
  type Handedness,
  type Mark,
  type MetricId,
} from '@pistol-kamae/engine';
import { useCallback, useMemo, useState, type RefObject } from 'react';
import type { AnalysisResult } from '../analysis/runAnalysis';
import { VideoPlayer } from '../components/VideoPlayer';
import { ja } from '../i18n/ja';
import { showFrame } from '../video/showFrame';

interface Props {
  videoRef: RefObject<HTMLVideoElement | null>;
  result: AnalysisResult | null;
  handedness: Handedness;
  marks: Mark[];
  onMarksChange: (marks: Mark[]) => void;
}

/** 角度は符号付き・小数 1 桁、比は小数 2 桁 */
function formatValue(id: MetricId, value: number): string {
  if (METRIC_UNITS[id] === 'deg') return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}`;
  return value.toFixed(2);
}

export function MarkScreen({ videoRef, result, handedness, marks, onMarksChange }: Props) {
  const [frameIndex, setFrameIndex] = useState(0);
  const [labelText, setLabelText] = useState('');
  const onFrameIndex = useCallback((i: number) => setFrameIndex(i), []);

  const shot = shotMarkOf(marks);
  const shotMetrics = useMemo(
    () =>
      result && shot
        ? metricsAtTime(
            { frames: result.frames, handedness, imageWidth: result.width },
            shot.timeSec,
          )
        : null,
    [result, shot, handedness],
  );

  if (!result) {
    return (
      <section>
        <h2>{ja.mark.title}</h2>
        <p>{ja.mark.noResult}</p>
      </section>
    );
  }

  const current = result.frames[frameIndex];
  const label = normalizeMarkLabel(labelText);

  const markShot = () => {
    if (current) onMarksChange(setShotMark(marks, current.timeSec));
  };
  const addCustom = () => {
    if (!current || label === null) return;
    onMarksChange(addCustomMark(marks, { id: nextMarkId(marks), label, timeSec: current.timeSec }));
    setLabelText('');
  };
  const jumpTo = (mark: Mark) => {
    const video = videoRef.current;
    if (video) showFrame(video, result, frameIndexAt(result.frames, mark.timeSec));
  };

  return (
    <section>
      <h2>{ja.mark.title}</h2>
      <p className="muted small">{ja.mark.intro}</p>

      <VideoPlayer videoRef={videoRef} result={result} onFrameIndex={onFrameIndex} />

      <h3>{ja.mark.addTitle}</h3>
      <div className="row">
        <button className="primary" data-testid="mark-shot" disabled={!current} onClick={markShot}>
          {shot ? ja.mark.resetShot : ja.mark.setShot}
        </button>
      </div>
      <div className="row">
        <label className="field grow">
          <span>{ja.mark.customLabel}</span>
          <input
            type="text"
            data-testid="custom-label"
            value={labelText}
            placeholder={ja.mark.customPlaceholder}
            maxLength={30}
            onChange={(e) => setLabelText(e.target.value)}
          />
        </label>
        <button data-testid="add-custom" disabled={!current || label === null} onClick={addCustom}>
          {ja.mark.addCustom}
        </button>
      </div>

      <h3>{ja.mark.listTitle}</h3>
      {!shot && <p className="danger small">{ja.mark.shotRequired}</p>}
      {marks.length === 0 ? (
        <p className="muted small">{ja.mark.listEmpty}</p>
      ) : (
        <ul className="mark-list" data-testid="mark-list">
          {marks.map((m) => {
            const index = frameIndexAt(result.frames, m.timeSec);
            return (
              <li
                key={m.id}
                data-testid="mark-item"
                data-mark-id={m.id}
                data-mark-kind={m.kind}
                data-frame-index={index}
              >
                <button
                  className={index === frameIndex ? 'mark-jump active' : 'mark-jump'}
                  data-testid="mark-jump"
                  onClick={() => jumpTo(m)}
                >
                  <strong>{m.kind === 'shot' ? ja.mark.shotName : m.label}</strong>
                  <span className="small">{ja.mark.position(index, m.timeSec)}</span>
                </button>
                <button
                  data-testid="mark-remove"
                  aria-label={ja.mark.removeAria(m.kind === 'shot' ? ja.mark.shotName : m.label)}
                  onClick={() => onMarksChange(removeMark(marks, m.id))}
                >
                  {ja.mark.remove}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <h3>{ja.mark.tableTitle}</h3>
      {!shotMetrics ? (
        <p className="muted small" data-testid="shot-table-empty">
          {ja.mark.tableNoShot}
        </p>
      ) : (
        <>
          <p className="muted small">
            {ja.mark.tableFrame(shotMetrics.frameIndex, shotMetrics.timeSec)}
          </p>
          {!shotMetrics.values && <p className="danger small">{ja.mark.tableNoPerson}</p>}
          <table
            className="table"
            data-testid="shot-table"
            data-frame-index={shotMetrics.frameIndex}
          >
            <thead>
              <tr>
                <th>{ja.mark.columns.metric}</th>
                <th>{ja.mark.columns.value}</th>
                <th>{ja.mark.columns.unit}</th>
              </tr>
            </thead>
            <tbody>
              {METRIC_IDS.map((id) => {
                const value = shotMetrics.values?.[id] ?? null;
                return (
                  <tr
                    key={id}
                    className={value === null ? 'unavailable' : undefined}
                    data-metric={id}
                    data-value={value ?? ''}
                  >
                    <td>{ja.metrics[id]}</td>
                    <td className="num">{value === null ? ja.mark.na : formatValue(id, value)}</td>
                    <td>{ja.units[METRIC_UNITS[id]]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted small">{ja.mark.tableLegend}</p>
        </>
      )}
      <p className="muted small">{ja.mark.notSaved}</p>
    </section>
  );
}
