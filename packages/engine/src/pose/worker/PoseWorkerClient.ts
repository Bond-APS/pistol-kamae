import type { CommonLandmarks } from '../../landmarks/types';
import type { PoseBackendConfig } from '../config';
import type { PoseWorkerRequest, PoseWorkerResponse } from './protocol';

export interface EstimateResult {
  landmarks: CommonLandmarks | null;
  inferenceMs: number;
}

/**
 * Worker 内の姿勢推定を、画面側から Promise で扱えるようにする窓口。
 * 1 フレームずつ送り、結果を待ってから次を送る（Worker 側に画像を溜めない）。
 */
export class PoseWorkerClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (r: EstimateResult) => void; reject: (e: Error) => void }
  >();
  private readyWaiter: { resolve: (id: string) => void; reject: (e: Error) => void } | null = null;

  constructor() {
    this.worker = new Worker(new URL('./poseWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<PoseWorkerResponse>) => this.handle(event.data);
    this.worker.onerror = (event) => {
      const err = new Error(event.message || 'Worker error');
      this.readyWaiter?.reject(err);
      this.readyWaiter = null;
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    };
  }

  /** バックエンドを準備する。返り値はバックエンドの識別子 */
  init(config: PoseBackendConfig): Promise<string> {
    return new Promise((resolve, reject) => {
      this.readyWaiter = { resolve, reject };
      this.send({ type: 'init', config });
    });
  }

  /** 1 フレームを推定する。image の所有権は Worker に移る（呼び出し側では使えなくなる） */
  estimate(image: ImageBitmap, timestampMs: number): Promise<EstimateResult> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ type: 'estimate', id, image, timestampMs }, [image]);
    });
  }

  /** Worker を止めて解放する */
  terminate(): void {
    this.send({ type: 'dispose' });
    this.worker.terminate();
    const err = new Error('terminated');
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  private send(message: PoseWorkerRequest, transfer: Transferable[] = []): void {
    this.worker.postMessage(message, transfer);
  }

  private handle(msg: PoseWorkerResponse): void {
    switch (msg.type) {
      case 'ready':
        this.readyWaiter?.resolve(msg.backendId);
        this.readyWaiter = null;
        return;
      case 'result': {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        p?.resolve({ landmarks: msg.landmarks, inferenceMs: msg.inferenceMs });
        return;
      }
      case 'error': {
        const err = new Error(msg.message);
        if (msg.id === undefined) {
          this.readyWaiter?.reject(err);
          this.readyWaiter = null;
        } else {
          const p = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          p?.reject(err);
        }
        return;
      }
    }
  }
}
