import { describe, expect, it } from 'vitest';
import { FrameSignature, snapFrameRate } from './seek';

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

describe('FrameSignature.same', () => {
  it('同じ配列なら true、違えば false', () => {
    const a = new Uint8ClampedArray([1, 2, 3]);
    expect(FrameSignature.same(a, new Uint8ClampedArray([1, 2, 3]))).toBe(true);
    expect(FrameSignature.same(a, new Uint8ClampedArray([1, 2, 4]))).toBe(false);
    expect(FrameSignature.same(null, a)).toBe(false);
  });
});
