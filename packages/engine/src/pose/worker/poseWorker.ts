/// <reference lib="webworker" />
// 姿勢推定を画面と別のスレッドで動かす Worker 本体。
// 画面側は PoseWorkerClient を通して使う。

import { createBackend } from '../createBackend';
import type { PoseBackend } from '../PoseBackend';
import type { PoseWorkerRequest, PoseWorkerResponse } from './protocol';

let backend: PoseBackend | null = null;

const post = (message: PoseWorkerResponse): void => {
  self.postMessage(message);
};

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

self.onmessage = async (event: MessageEvent<PoseWorkerRequest>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'init': {
      try {
        backend?.dispose();
        backend = await createBackend(msg.config);
        await backend.init();
        post({ type: 'ready', backendId: backend.id });
      } catch (e) {
        backend = null;
        post({ type: 'error', message: errorMessage(e) });
      }
      return;
    }
    case 'estimate': {
      if (!backend) {
        msg.image.close();
        post({ type: 'error', id: msg.id, message: 'backend not initialized' });
        return;
      }
      const start = performance.now();
      try {
        const landmarks = await backend.estimate(msg.image, msg.timestampMs);
        post({ type: 'result', id: msg.id, landmarks, inferenceMs: performance.now() - start });
      } catch (e) {
        post({ type: 'error', id: msg.id, message: errorMessage(e) });
      } finally {
        msg.image.close();
      }
      return;
    }
    case 'dispose': {
      backend?.dispose();
      backend = null;
      return;
    }
  }
};
