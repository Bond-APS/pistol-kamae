import { describe, expect, it } from 'vitest';
import {
  FrameSignature,
  frameRateFromChangeTimes,
  seekTo,
  SeekAbortedError,
  SeekTimeoutError,
  snapFrameRate,
} from './seek';

describe('snapFrameRate', () => {
  it('よくある fps に近ければ丸める', () => {
    expect(snapFrameRate(29)).toBe(29.97);
    expect(snapFrameRate(30.5)).toBe(30);
    expect(snapFrameRate(58)).toBe(59.94);
    expect(snapFrameRate(61)).toBe(60);
  });
  it('離れていればそのまま', () => {
    expect(snapFrameRate(40)).toBe(40);
    expect(snapFrameRate(15)).toBe(15);
  });
});

describe('frameRateFromChangeTimes', () => {
  const at = (fps: number, n: number) => Array.from({ length: n }, (_, i) => i / fps);
  // 1/120 秒刻みで観測したときの時刻（切り上げ）に丸める
  const observed = (times: number[]) => times.map((t) => Math.ceil(t * 120 - 1e-9) / 120);

  it('30fps', () => {
    expect(frameRateFromChangeTimes(observed(at(30, 30)))).toBe(30);
  });
  it('60fps', () => {
    expect(frameRateFromChangeTimes(observed(at(60, 60)))).toBe(60);
  });
  it('25fps（刻みと割り切れない）', () => {
    expect(frameRateFromChangeTimes(observed(at(25, 25)))).toBe(25);
  });
  it('切り替わりを数回見落としても 30fps と判定する', () => {
    const times = observed(at(30, 30)).filter((_, i) => ![5, 11, 12, 20].includes(i));
    expect(frameRateFromChangeTimes(times)).toBe(30);
  });
  it('点が少なければ null', () => {
    expect(frameRateFromChangeTimes([0, 0.033])).toBeNull();
  });
});

describe('FrameSignature.same', () => {
  it('同じ配列なら true、違えば false', () => {
    const a = new Uint8ClampedArray([1, 2, 3]);
    expect(FrameSignature.same(a, new Uint8ClampedArray([1, 2, 3]))).toBe(true);
    expect(FrameSignature.same(a, new Uint8ClampedArray([1, 2, 4]))).toBe(false);
    expect(FrameSignature.same(null, a)).toBe(false);
  });
});

describe('seekTo', () => {
  /** seeked を自分では起こさない模擬の video。登録された待ち（イベントの購読）の種類を数える */
  class FakeVideo extends EventTarget {
    currentTime = 0;
    readonly listening = new Set<string>();
    override addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: AddEventListenerOptions | boolean,
    ): void {
      this.listening.add(type);
      super.addEventListener(type, listener, options);
    }
    override removeEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: EventListenerOptions | boolean,
    ): void {
      this.listening.delete(type);
      super.removeEventListener(type, listener, options);
    }
  }
  const asVideo = (v: FakeVideo) => v as unknown as HTMLVideoElement;

  it('時間内に seeked が来れば、そのときの時刻を返し、待ちを解除する', async () => {
    const video = new FakeVideo();
    const promise = seekTo(asVideo(video), 1.5, { settleMs: 5, timeoutMs: 1000 });
    expect(video.currentTime).toBe(1.5);
    video.dispatchEvent(new Event('seeked'));
    await expect(promise).resolves.toEqual({ timeSec: 1.5, exact: false });
    expect(video.listening.size).toBe(0);
  });
  it('seeked が来たあとは、猶予の間に上限が来ても時間切れにしない', async () => {
    const video = new FakeVideo();
    const promise = seekTo(asVideo(video), 1.5, { settleMs: 40, timeoutMs: 20 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    video.dispatchEvent(new Event('seeked'));
    await expect(promise).resolves.toEqual({ timeSec: 1.5, exact: false });
    expect(video.listening.size).toBe(0);
  });
  it('時間切れは SeekTimeoutError で失敗にし、待ちを解除する', async () => {
    const video = new FakeVideo();
    const promise = seekTo(asVideo(video), 1.5, { timeoutMs: 20 });
    await expect(promise).rejects.toBeInstanceOf(SeekTimeoutError);
    expect(video.listening.size).toBe(0);
  });
  it('中断の合図で SeekAbortedError にし、待ちを解除する', async () => {
    const video = new FakeVideo();
    const controller = new AbortController();
    const promise = seekTo(asVideo(video), 1.5, { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toBeInstanceOf(SeekAbortedError);
    expect(video.listening.size).toBe(0);
  });
  it('すでに中断されていれば、シークせずに失敗にする', async () => {
    const video = new FakeVideo();
    const controller = new AbortController();
    controller.abort();
    await expect(seekTo(asVideo(video), 1.5, { signal: controller.signal })).rejects.toBeInstanceOf(
      SeekAbortedError,
    );
    expect(video.currentTime).toBe(0);
    expect(video.listening.size).toBe(0);
  });
  it('上限を指定しなければ待ち続ける（これまでどおり）', async () => {
    const video = new FakeVideo();
    let settled = false;
    const mark = () => {
      settled = true;
    };
    void seekTo(asVideo(video), 1.5, { settleMs: 5 }).then(mark, mark);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(settled).toBe(false);
    expect(video.listening.size).toBe(2);
  });
});
