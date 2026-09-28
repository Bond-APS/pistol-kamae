/**
 * 姿勢推定バックエンドの設定。
 * モデルファイルや wasm の置き場所（URL）は UI 側が決めて渡す（engine は場所を決め打ちしない）。
 */

export type MediaPipeModel = 'lite' | 'full' | 'heavy';

/**
 * MediaPipe の実行モード。
 * - video：前後のフレームを使って点の揺れを内部でならす（本番向け。速い）
 * - image：1 枚ずつ独立に推定する（内部平滑化なし。生のノイズを測るのに使う）
 */
export type MediaPipeRunningMode = 'video' | 'image';

export interface MediaPipeBackendConfig {
  kind: 'mediapipe';
  model: MediaPipeModel;
  runningMode: MediaPipeRunningMode;
  /** GPU が使えなければ CPU に切り替える。既定は GPU */
  delegate?: 'GPU' | 'CPU';
  /**
   * wasm ローダー（ES モジュール版 vision_wasm_module_internal.js）の URL。
   * Worker からは動的 import で読み込まれるため、モジュールとして配信される URL でなければならない。
   */
  wasmLoaderPath: string;
  /** wasm 本体（vision_wasm_module_internal.wasm）の URL */
  wasmBinaryPath: string;
  /** .task モデルファイルの URL */
  modelAssetPath: string;
}

export interface MoveNetBackendConfig {
  kind: 'movenet';
  /** model.json の URL */
  modelUrl: string;
  /** 内部の時間方向の平滑化。既定 false（生のノイズを測るため） */
  enableSmoothing?: boolean;
}

export type PoseBackendConfig = MediaPipeBackendConfig | MoveNetBackendConfig;

/** 設定から識別子（例：'mediapipe-full-video'）を作る */
export function backendIdOf(config: PoseBackendConfig): string {
  if (config.kind === 'mediapipe') {
    return `mediapipe-${config.model}-${config.runningMode}`;
  }
  return `movenet-thunder${config.enableSmoothing ? '-smoothed' : ''}`;
}
