import type { CommonLandmarks } from '../../landmarks/types';
import type { PoseBackendConfig } from '../config';

/** 画面 → Worker へ送るメッセージ */
export type PoseWorkerRequest =
  | { type: 'init'; config: PoseBackendConfig }
  | { type: 'estimate'; id: number; image: ImageBitmap; timestampMs: number }
  | { type: 'dispose' };

/** Worker → 画面 へ返すメッセージ */
export type PoseWorkerResponse =
  | { type: 'ready'; backendId: string }
  | {
      type: 'result';
      id: number;
      landmarks: CommonLandmarks | null;
      /** 推定にかかった時間（ミリ秒） */
      inferenceMs: number;
    }
  | { type: 'error'; id?: number; message: string };
