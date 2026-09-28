// @tensorflow-models/pose-detection は BlazePose（MediaPipe 実行版）のために
// @mediapipe/pose を読み込むが、本アプリでは MoveNet しか使わない。
// @mediapipe/pose は ESM 形式でなくビルドが通らないため、この空の代替に差し替える
// （apps/web/vite.config.ts の resolve.alias を参照）。
export const Pose = undefined;
