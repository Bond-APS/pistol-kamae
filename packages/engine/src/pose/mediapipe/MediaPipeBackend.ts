import { PoseLandmarker } from '@mediapipe/tasks-vision';
import { fromMediaPipe } from '../../landmarks/fromMediaPipe';
import type { CommonLandmarks } from '../../landmarks/types';
import { backendIdOf, type MediaPipeBackendConfig } from '../config';
import type { PoseBackend } from '../PoseBackend';

/** MediaPipe Pose Landmarker（33 点）を使うバックエンド */
export class MediaPipeBackend implements PoseBackend {
  readonly id: string;
  private landmarker: PoseLandmarker | null = null;
  private lastTimestampMs = -1;

  constructor(private readonly config: MediaPipeBackendConfig) {
    this.id = backendIdOf(config);
  }

  async init(): Promise<void> {
    // FilesetResolver は使わず、UI 側から渡された URL をそのまま使う
    // （バンドラーが配置した場所を engine が推測しないため）
    const fileset = {
      wasmLoaderPath: this.config.wasmLoaderPath,
      wasmBinaryPath: this.config.wasmBinaryPath,
    };
    this.landmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: this.config.modelAssetPath,
        delegate: this.config.delegate ?? 'GPU',
      },
      runningMode: this.config.runningMode === 'video' ? 'VIDEO' : 'IMAGE',
      numPoses: 1,
      outputSegmentationMasks: false,
    });
  }

  async estimate(image: ImageBitmap, timestampMs: number): Promise<CommonLandmarks | null> {
    if (!this.landmarker) throw new Error('MediaPipeBackend: init() が呼ばれていません');
    let result;
    if (this.config.runningMode === 'video') {
      // 動画モードは時刻が単調増加でなければならない
      const ts = timestampMs <= this.lastTimestampMs ? this.lastTimestampMs + 1 : timestampMs;
      this.lastTimestampMs = ts;
      result = this.landmarker.detectForVideo(image, ts);
    } else {
      result = this.landmarker.detect(image);
    }
    const first = result.landmarks[0];
    if (!first) return null;
    return fromMediaPipe(first, image.width, image.height);
  }

  dispose(): void {
    this.landmarker?.close();
    this.landmarker = null;
  }
}
