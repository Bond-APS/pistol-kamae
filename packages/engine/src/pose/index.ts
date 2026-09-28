// 姿勢推定まわりの公開窓口。
// '@pistol-kamae/engine/pose' として読み込む（本体の index.ts とは分けて、必要なときだけ取り込む）。

export {
  backendIdOf,
  type MediaPipeBackendConfig,
  type MediaPipeModel,
  type MediaPipeRunningMode,
  type MoveNetBackendConfig,
  type PoseBackendConfig,
} from './config';
export { createBackend } from './createBackend';
export type { PoseBackend } from './PoseBackend';
export { PoseWorkerClient, type EstimateResult } from './worker/PoseWorkerClient';
