import { describe, expect, it } from 'vitest';
import { FrameSignature, frameRateFromChangeTimes, snapFrameRate } from './seek';

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
