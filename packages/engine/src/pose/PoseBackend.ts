import type { CommonLandmarks } from '../landmarks/types';

/**
 * 姿勢推定バックエンドの差し替え口。
 * MediaPipe・MoveNet など、どのモデルもこの約束事に従って実装する。
 * 出力は必ず共通ランドマーク形式（画素座標）。
 */
export interface PoseBackend {
  /** 識別子（例：'mediapipe-full'、'movenet-thunder'） */
  readonly id: string;

  /** モデルの読込など、最初に 1 回だけ行う準備 */
  init(): Promise<void>;

  /**
   * 1 フレームを推定する。
   * @param image 画像。Web Worker でも扱えるよう ImageBitmap を受け取る
   * @param timestampMs 動画内の時刻（ミリ秒）。動画モードの内部平滑化で時系列として使われる
   * @returns 共通ランドマーク。人物が検出できなければ null
   */
  estimate(image: ImageBitmap, timestampMs: number): Promise<CommonLandmarks | null>;

  /** モデルを解放する */
  dispose(): void;
}
