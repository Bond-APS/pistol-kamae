// MediaPipe の wasm はライブラリ同梱のものを Vite に配置させる（?url で配置先の URL を受け取る）。
// ES モジュール版（_module_）を使う。Worker から動的 import で読み込むため。
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_module_internal.js?url';
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_module_internal.wasm?url';
import type { PoseBackendConfig } from '@pistol-kamae/engine/pose';
import { ja } from '../i18n/ja';

export type BackendChoice = keyof typeof ja.backends;

export const BACKEND_CHOICES: BackendChoice[] = [
  'mediapipeFullVideo',
  'mediapipeLiteVideo',
  'mediapipeHeavyVideo',
  'mediapipeFullImage',
  'mediapipeLiteImage',
  'mediapipeHeavyImage',
  'movenetThunder',
];

export const DEFAULT_BACKEND: BackendChoice = 'mediapipeFullVideo';

// モデルファイルはアプリと一緒に置く（外部通信なし）。
// import.meta.env.BASE_URL は開発時 '/'、公開時 '/pistol-kamae/'。
const base = import.meta.env.BASE_URL;

// Worker 内では相対 URL の基準が変わるため、絶対 URL にしてから渡す
const absolute = (path: string): string => new URL(path, window.location.href).href;

export function backendConfigOf(choice: BackendChoice): PoseBackendConfig {
  if (choice === 'movenetThunder') {
    return {
      kind: 'movenet',
      modelUrl: absolute(`${base}models/movenet-thunder/model.json`),
      enableSmoothing: false,
    };
  }
  const model = choice.includes('Lite') ? 'lite' : choice.includes('Heavy') ? 'heavy' : 'full';
  const runningMode = choice.endsWith('Image') ? 'image' : 'video';
  return {
    kind: 'mediapipe',
    model,
    runningMode,
    delegate: 'GPU',
    wasmLoaderPath: absolute(wasmLoaderPath),
    wasmBinaryPath: absolute(wasmBinaryPath),
    modelAssetPath: absolute(`${base}models/mediapipe/pose_landmarker_${model}.task`),
  };
}
