import type { LandmarkFrame } from '@pistol-kamae/engine';
import { PoseWorkerClient, type PoseBackendConfig } from '@pistol-kamae/engine/pose';
import { SeekSession } from '../video/seek';

export interface AnalysisTiming {
  totalMs: number;
  /** 推定（Worker 内）にかかった時間の合計 */
  inferenceMs: number;
  /** シークと画像取り出しにかかった時間の合計 */
  seekMs: number;
}

export interface AnalysisResult {
  backendId: string;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  frames: LandmarkFrame[];
  timing: AnalysisTiming;
  /** GPU が使えず CPU に切り替えたなど、補足があれば */
  notes: string[];
}

export interface RunAnalysisOptions {
  video: HTMLVideoElement;
  config: PoseBackendConfig;
  fps: number;
  signal: AbortSignal;
  onProgress: (done: number, total: number) => void;
  onPreparing: () => void;
}

class AbortedError extends Error {
  constructor() {
    super('aborted');
    this.name = 'AbortedError';
  }
}

export const isAborted = (e: unknown): boolean => e instanceof AbortedError;

/**
 * 動画全長に姿勢推定をかける。
 * 1 フレームずつ「シーク → 画像取り出し → Worker で推定」を繰り返す。
 * 同じフレームが 2 回表示された場合（媒体時刻が同じ）は飛ばす。
 */
export async function runAnalysis(opts: RunAnalysisOptions): Promise<AnalysisResult> {
  const { video, signal, fps } = opts;
  const started = performance.now();
  const client = new PoseWorkerClient();
  const notes: string[] = [];
  const throwIfAborted = () => {
    if (signal.aborted) throw new AbortedError();
  };

  try {
    opts.onPreparing();
    let backendId: string;
    try {
      backendId = await client.init(opts.config);
    } catch (e) {
      // GPU が使えない端末では CPU で再試行する
      if (opts.config.kind === 'mediapipe' && opts.config.delegate !== 'CPU') {
        backendId = await client.init({ ...opts.config, delegate: 'CPU' });
        notes.push('gpuFallback');
      } else {
        throw e;
      }
    }
    throwIfAborted();

    const width = video.videoWidth;
    const height = video.videoHeight;
    const duration = video.duration;
    const step = 1 / fps;
    const total = Math.ceil(duration * fps);
    const frames: LandmarkFrame[] = [];
    let inferenceMs = 0;
    let seekMs = 0;
    let lastExactTime = -1;
    const session = new SeekSession();

    for (let i = 0; i < total; i++) {
      throwIfAborted();
      // 各フレームの「真ん中」の時刻へシークする。フレーム境界ぴったりだと前後どちらが
      // 表示されるか曖昧になるため、半フレームずらして確実にそのフレームを表示させる。
      const nominalTime = i * step;
      const target = nominalTime + step / 2;
      if (target >= duration) break;
      const seekStart = performance.now();
      const seek = await session.seek(video, target);
      // 正確な時刻が取れた場合だけ、同じフレームの二重処理を避ける
      if (seek.exact) {
        if (seek.timeSec === lastExactTime) continue;
        lastExactTime = seek.timeSec;
      }
      const bitmap = await createImageBitmap(video);
      seekMs += performance.now() - seekStart;

      throwIfAborted();
      const timeSec = seek.exact ? seek.timeSec : nominalTime;
      const result = await client.estimate(bitmap, timeSec * 1000);
      inferenceMs += result.inferenceMs;
      frames.push({ timeSec, landmarks: result.landmarks });
      opts.onProgress(frames.length, total);
    }

    return {
      backendId,
      width,
      height,
      fps,
      durationSec: duration,
      frames,
      timing: { totalMs: performance.now() - started, inferenceMs, seekMs },
      notes,
    };
  } finally {
    client.terminate();
  }
}
