// MediaPipe の wasm はライブラリ同梱のものを Vite に配置させる（?url で配置先の URL を受け取る）。
// ES モジュール版（_module_）を使う。Worker から動的 import で読み込むため。
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_module_internal.js?url';
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_module_internal.wasm?url';
import type { PoseBackendConfig } from '@pistol-kamae/engine/pose';

// モデルファイルはアプリと一緒に置く（外部通信なし）。
// import.meta.env.BASE_URL は開発時 '/'、公開時 '/pistol-kamae/'。
const base = import.meta.env.BASE_URL;

// Worker 内では相対 URL の基準が変わるため、絶対 URL にしてから渡す
const absolute = (path: string): string => new URL(path, window.location.href).href;

/**
 * アプリが使う姿勢推定の設定。
 * モデルは MediaPipe full・動画モードの 1 種類に固定する（段階①の実測で速度・ノイズとも合格）。
 * 基準と比較で別のモデルを使うと数値が系統的にずれるため、利用者には選ばせない。
 */
export function poseBackendConfig(): PoseBackendConfig {
  return {
    kind: 'mediapipe',
    model: 'full',
    runningMode: 'video',
    delegate: 'GPU',
    wasmLoaderPath: absolute(wasmLoaderPath),
    wasmBinaryPath: absolute(wasmBinaryPath),
    modelAssetPath: absolute(`${base}models/mediapipe/pose_landmarker_full.task`),
  };
}
