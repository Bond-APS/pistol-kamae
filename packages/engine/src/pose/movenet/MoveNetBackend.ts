import * as poseDetection from '@tensorflow-models/pose-detection';
import '@tensorflow/tfjs-backend-webgl';
import * as tf from '@tensorflow/tfjs-core';
import { fromCoco17 } from '../../landmarks/fromMoveNet';
import type { CommonLandmarks } from '../../landmarks/types';
import { backendIdOf, type MoveNetBackendConfig } from '../config';
import type { PoseBackend } from '../PoseBackend';

/** MoveNet SinglePose Thunder（COCO 17 点、TensorFlow.js）を使うバックエンド */
export class MoveNetBackend implements PoseBackend {
  readonly id: string;
  private detector: poseDetection.PoseDetector | null = null;

  constructor(private readonly config: MoveNetBackendConfig) {
    this.id = backendIdOf(config);
  }

  async init(): Promise<void> {
    await tf.setBackend('webgl');
    await tf.ready();
    this.detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
      modelType: poseDetection.movenet.modelType.SINGLEPOSE_THUNDER,
      modelUrl: this.config.modelUrl,
      enableSmoothing: this.config.enableSmoothing ?? false,
    });
  }

  async estimate(image: ImageBitmap, timestampMs: number): Promise<CommonLandmarks | null> {
    if (!this.detector) throw new Error('MoveNetBackend: init() が呼ばれていません');
    const poses = await this.detector.estimatePoses(
      image,
      { maxPoses: 1, flipHorizontal: false },
      timestampMs,
    );
    const first = poses[0];
    if (!first) return null;
    return fromCoco17(first.keypoints);
  }

  dispose(): void {
    this.detector?.dispose();
    this.detector = null;
  }
}
