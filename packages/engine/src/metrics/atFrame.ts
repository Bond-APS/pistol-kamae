import { frameIndexAt } from '../landmarks/frames';
import type { LandmarkFrame } from '../landmarks/types';
import { toSided, type Handedness } from '../normalize/handedness';
import { applyLevel } from '../normalize/level';
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
  /** 動画の高さ（画素）。幅と合わせて、画面の外にある点を計測から外すのに使う */
  imageHeight: number;
  /**
   * カメラの傾き（度。水平校正の線から求めたもの）。0 以外なら、この分だけ関節の位置を回してから計算する。
   * 省略時は 0（補正しない）
   */
  tiltDeg?: number;
  /** 閾値など。imageSize は上の幅・高さから自動で入る */
  options?: MetricOptions;
}

/** 指定した番号のフレームの計測値。番号が範囲外なら null */
export function metricsAtFrame(input: FrameMetricsInput, frameIndex: number): FrameMetrics | null {
  const frame = input.frames[frameIndex];
  if (!Number.isInteger(frameIndex) || !frame) return null;
  const imageSize = { width: input.imageWidth, height: input.imageHeight };
  const tiltDeg = input.tiltDeg ?? 0;
  let values: MetricValues | null = null;
  if (frame.landmarks && tiltDeg !== 0) {
    // 画面の外にある点は applyLevel が先に外すので、回したあとの座標では画面の内外を調べない
    const leveled = applyLevel(frame.landmarks, tiltDeg, imageSize);
    const options = { ...input.options };
    delete options.imageSize;
    values = computeMetrics(toSided(leveled, input.handedness, input.imageWidth), options);
  } else if (frame.landmarks) {
    values = computeMetrics(toSided(frame.landmarks, input.handedness, input.imageWidth), {
      imageSize,
      ...input.options,
    });
  }
  return { frameIndex, timeSec: frame.timeSec, values };
}

/** 指定した時刻（マークの時刻など）を含むフレームの計測値。フレームがなければ null */
export function metricsAtTime(input: FrameMetricsInput, timeSec: number): FrameMetrics | null {
  return metricsAtFrame(input, frameIndexAt(input.frames, timeSec));
}
