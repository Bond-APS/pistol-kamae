import type { LandmarkFrame } from '@pistol-kamae/engine';
import { ja } from '../i18n/ja';
import { relativeTimeLabel } from './relativeTime';

interface Props {
  /** base：基準、current：今回 */
  role: 'base' | 'current';
  frames: ReadonlyArray<LandmarkFrame>;
  /** 表示中のフレーム番号 */
  index: number;
  /** 撃発フレームの番号 */
  shotIndex: number;
  onChange: (index: number) => void;
}

/** 比較画面の、時点を選ぶバー（基準用と今回用に 1 本ずつ）。1 コマ送りと「撃発へ」付き */
export function TimeBar({ role, frames, index, shotIndex, onChange }: Props) {
  const last = Math.max(frames.length - 1, 0);
  const go = (i: number) => onChange(Math.min(Math.max(i, 0), last));
  const name = role === 'base' ? ja.compare.base : ja.compare.current;
  return (
    <div className="time-bar" data-testid={`time-${role}`} data-frame-index={index}>
      <div className="time-head">
        <span className={`skeleton-key ${role}`} aria-hidden="true" />
        {name}
        <span className="time-label num" data-testid={`time-${role}-label`}>
          {relativeTimeLabel(frames, index, shotIndex)}
        </span>
      </div>
      <input
        type="range"
        className="slider"
        aria-label={ja.compare.timeSlider(name)}
        data-testid={`time-${role}-slider`}
        min={0}
        max={last}
        step={1}
        value={index}
        onChange={(e) => go(Number(e.target.value))}
      />
      <div className="time-buttons">
        <button
          data-testid={`time-${role}-prev`}
          disabled={index <= 0}
          onClick={() => go(index - 1)}
        >
          {ja.player.prevFrame}
        </button>
        <button
          data-testid={`time-${role}-shot`}
          disabled={index === shotIndex}
          onClick={() => go(shotIndex)}
        >
          {ja.compare.toShot}
        </button>
        <button
          data-testid={`time-${role}-next`}
          disabled={index >= last}
          onClick={() => go(index + 1)}
        >
          {ja.player.nextFrame}
        </button>
      </div>
    </div>
  );
}
