import type { PoseBackendConfig } from './config';
import type { PoseBackend } from './PoseBackend';

/**
 * 設定に応じたバックエンドを作る。
 * 各バックエンドのライブラリは大きいので、必要になったときだけ読み込む（動的 import）。
 */
export async function createBackend(config: PoseBackendConfig): Promise<PoseBackend> {
  switch (config.kind) {
    case 'mediapipe': {
      const { MediaPipeBackend } = await import('./mediapipe/MediaPipeBackend');
      return new MediaPipeBackend(config);
    }
    case 'movenet': {
      const { MoveNetBackend } = await import('./movenet/MoveNetBackend');
      return new MoveNetBackend(config);
    }
  }
}
