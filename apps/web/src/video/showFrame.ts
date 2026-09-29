import { seekTimeForFrame } from '../analysis/frames';
import type { AnalysisResult } from '../analysis/runAnalysis';

/** video を一時停止して、指定したフレームを表示させる */
export function showFrame(video: HTMLVideoElement, result: AnalysisResult, index: number): void {
  const clamped = Math.min(Math.max(index, 0), result.frames.length - 1);
  if (!result.frames[clamped]) return;
  video.pause();
  video.currentTime = seekTimeForFrame(result.frames, clamped, result.fps);
}
