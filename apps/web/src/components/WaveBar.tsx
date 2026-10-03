import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { binTimeSec, type AudioEnvelope } from '../audio/envelope';
import { ja } from '../i18n/ja';

/** バーの上に描く音のグラフ（1 本または 2 本） */
export interface WaveSeries {
  key: string;
  envelope: AudioEnvelope;
  /** 動画の時刻 → バーの時刻 のずれ（秒）。比較画面で撃発を 0 に揃えるときに使う */
  shiftSec?: number;
  className: string;
}

/** バーに付ける印（撃発など） */
export interface BarMarker {
  key: string;
  sec: number;
  label: string;
}

/** 切り抜きの取っ手（開始・終了）。渡すと、取っ手を引いて範囲を変えられる */
export interface ClipHandles {
  startSec: number;
  endSec: number;
  onChange: (startSec: number, endSec: number) => void;
}

interface Props {
  /** バーの左端・右端の時刻（秒） */
  startSec: number;
  endSec: number;
  /** つまみの時刻（秒） */
  valueSec: number;
  /** つまみの最小の動き（秒）。1 コマの長さ */
  stepSec: number;
  onChange: (sec: number) => void;
  waves?: WaveSeries[];
  /** 音が取れない（グラフを出せない）ことを示す */
  noAudio?: boolean;
  markers?: BarMarker[];
  handles?: ClipHandles;
  /** 両端に出す文字 */
  startLabel: string;
  endLabel: string;
  ariaLabel: string;
  testId: string;
}

const WAVE_W = 1000;
const WAVE_H = 40;
/** グラフの点の上限。これより細かい区切りはまとめる（描画を軽くするため） */
const WAVE_POINTS = 400;

/** 包絡線を、バーの範囲に合わせて SVG の折れ線にする */
function wavePath(series: WaveSeries, startSec: number, endSec: number): string {
  const { envelope, shiftSec = 0 } = series;
  const span = endSec - startSec;
  if (!(span > 0)) return '';
  const points = Math.min(WAVE_POINTS, Math.max(2, Math.round(span / envelope.binSec)));
  const cell = span / points;
  const heights = new Float32Array(points);
  for (let i = 0; i < envelope.values.length; i++) {
    const t = binTimeSec(envelope, i) + shiftSec;
    const p = Math.floor((t - startSec) / cell);
    if (p < 0 || p >= points) continue;
    if (envelope.values[i]! > heights[p]!) heights[p] = envelope.values[i]!;
  }
  let d = `M0 ${WAVE_H}`;
  for (let p = 0; p < points; p++) {
    const x = ((p + 0.5) / points) * WAVE_W;
    d += ` L${x.toFixed(1)} ${(WAVE_H - heights[p]! * (WAVE_H - 2)).toFixed(1)}`;
  }
  return `${d} L${WAVE_W} ${WAVE_H} Z`;
}

/**
 * 時点を選ぶバー。上に音のグラフ、下につまみ。撃発などの印と、切り抜きの取っ手を重ねられる。
 * 保存の流れ（切り抜き・撃発ポイント）、動画を再生、比較の 3 か所で使う。
 */
export function WaveBar(props: Props) {
  const { startSec, endSec, valueSec, stepSec, onChange, waves, markers, handles } = props;
  const span = Math.max(endSec - startSec, stepSec);
  const pct = (sec: number) => `${(((sec - startSec) / span) * 100).toFixed(3)}%`;
  const trackRef = useRef<HTMLDivElement>(null);
  /** 取っ手を引いている間の状態 */
  const drag = useRef<{ which: 'start' | 'end'; pointerId: number } | null>(null);

  const secAt = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return startSec;
    const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    const raw = startSec + ratio * span;
    return Math.round(raw / stepSec) * stepSec;
  };
  const beginDrag = (which: 'start' | 'end') => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!handles) return;
    drag.current = { which, pointerId: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const moveDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || !handles || e.pointerId !== d.pointerId) return;
    const sec = secAt(e.clientX);
    if (d.which === 'start') {
      handles.onChange(Math.min(sec, handles.endSec - stepSec), handles.endSec);
    } else {
      handles.onChange(handles.startSec, Math.max(sec, handles.startSec + stepSec));
    }
  };
  const endDrag = () => {
    drag.current = null;
  };

  return (
    <div className="wave-bar" data-testid={props.testId} data-value-sec={valueSec.toFixed(3)}>
      {waves && waves.length > 0 ? (
        <svg
          className="wave"
          viewBox={`0 0 ${WAVE_W} ${WAVE_H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          data-testid={`${props.testId}-wave`}
        >
          {waves.map((w) => (
            <path key={w.key} className={w.className} d={wavePath(w, startSec, endSec)} />
          ))}
        </svg>
      ) : (
        props.noAudio && <p className="muted small wave-none">{ja.player.noAudio}</p>
      )}
      <div className="wave-track" ref={trackRef}>
        {handles && (
          <>
            <div className="wave-dim" style={{ left: 0, width: pct(handles.startSec) }} />
            <div className="wave-dim" style={{ left: pct(handles.endSec), right: 0 }} />
          </>
        )}
        {markers?.map((m) => (
          <div
            key={m.key}
            className="wave-marker"
            data-testid={`${props.testId}-marker-${m.key}`}
            style={{ left: pct(m.sec) }}
          >
            <span>{m.label}</span>
          </div>
        ))}
        <input
          type="range"
          className="slider wave-slider"
          aria-label={props.ariaLabel}
          data-testid={`${props.testId}-slider`}
          min={startSec}
          max={endSec}
          step={stepSec}
          value={Math.min(Math.max(valueSec, startSec), endSec)}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        {handles &&
          (['start', 'end'] as const).map((which) => (
            <div
              key={which}
              className={`wave-handle ${which}`}
              role="slider"
              aria-label={which === 'start' ? ja.clip.handleStart : ja.clip.handleEnd}
              aria-valuenow={which === 'start' ? handles.startSec : handles.endSec}
              data-testid={`${props.testId}-handle-${which}`}
              style={{ left: pct(which === 'start' ? handles.startSec : handles.endSec) }}
              onPointerDown={beginDrag(which)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              <span className="small num">
                {which === 'start'
                  ? ja.clip.startAt(handles.startSec)
                  : ja.clip.endAt(handles.endSec)}
              </span>
            </div>
          ))}
      </div>
      <div className="wave-scale muted small num">
        <span>{props.startLabel}</span>
        <span>{props.endLabel}</span>
      </div>
    </div>
  );
}
