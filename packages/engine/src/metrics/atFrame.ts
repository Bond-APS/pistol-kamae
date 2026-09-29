import { frameIndexAt } from '../landmarks/frames';
import type { LandmarkFrame } from '../landmarks/types';
import { toSided, type Handedness } from '../normalize/handedness';
import { computeMetrics, type MetricOptions } from './compute';
import type { MetricValues } from './types';

/** 1 フレームの計測結果 */
export interface FrameMetrics {
  frameIndex: number;
  /** そのフレームの媒体時刻（秒） */
  timeSec: number;
  /** 計測値。人物を検出できなかったフレームは null */
  values: MetricValues | null;
}

export interface FrameMetricsInput {
  frames: ReadonlyArray<LandmarkFrame>;
  handedness: Handedness;
  /** 動画の幅（画素）。左利きの左右反転に使う */
  imageWidth: number;
  options?: MetricOptions;
}

/** 指定した番号のフレームの計測値。番号が範囲外なら null */
export function metricsAtFrame(input: FrameMetricsInput, frameIndex: number): FrameMetrics | null {
  const frame = input.frames[frameIndex];
  if (!Number.isInteger(frameIndex) || !frame) return null;
  const values = frame.landmarks
    ? computeMetrics(toSided(frame.landmarks, input.handedness, input.imageWidth), input.options)
    : null;
  return { frameIndex, timeSec: frame.timeSec, values };
}

/** 指定した時刻（マークの時刻など）を含むフレームの計測値。フレームがなければ null */
export function metricsAtTime(input: FrameMetricsInput, timeSec: number): FrameMetrics | null {
  return metricsAtFrame(input, frameIndexAt(input.frames, timeSec));
}
