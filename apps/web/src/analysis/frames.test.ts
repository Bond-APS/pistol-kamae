import type { LandmarkFrame } from '@pistol-kamae/engine';
import { describe, expect, it } from 'vitest';
import { frameIndexAt, frameRange, seekTimeForFrame } from './frames';

const frames: LandmarkFrame[] = [0, 0.033, 0.067, 0.1].map((t) => ({
  timeSec: t,
  landmarks: null,
}));

describe('frameIndexAt', () => {
  it('その時刻を含むフレームを返す', () => {
    expect(frameIndexAt(frames, 0)).toBe(0);
    expect(frameIndexAt(frames, 0.02)).toBe(0);
    expect(frameIndexAt(frames, 0.033)).toBe(1);
    expect(frameIndexAt(frames, 0.05)).toBe(1);
    expect(frameIndexAt(frames, 0.0999)).toBe(3); // 許容誤差の範囲内
    expect(frameIndexAt(frames, 5)).toBe(3);
  });
  it('空なら -1', () => {
    expect(frameIndexAt([], 1)).toBe(-1);
  });
});

describe('seekTimeForFrame', () => {
  it('次のフレームとの中間を返す', () => {
    expect(seekTimeForFrame(frames, 0, 30)).toBeCloseTo(0.0165, 6);
    expect(seekTimeForFrame(frames, 1, 30)).toBeCloseTo(0.05, 6);
  });
  it('最後のフレームは fps から幅を決める', () => {
    expect(seekTimeForFrame(frames, 3, 30)).toBeCloseTo(0.1 + 1 / 60, 6);
  });
});

describe('frameRange', () => {
  // 30 fps のつもりで 0, 1/30, 2/30, … の 10 コマ
  const ten: LandmarkFrame[] = Array.from({ length: 10 }, (_, i) => ({
    timeSec: i / 30,
    landmarks: null,
  }));
  /** 先頭から順に数える、素朴な求め方（二分探索の答え合わせ用） */
  const linear = (fs: LandmarkFrame[], startSec: number, endSec: number) => {
    const eps = 1e-6;
    let first = fs.findIndex((f) => f.timeSec >= startSec - eps);
    if (first < 0) first = fs.length - 1;
    let last = first;
    while (last + 1 < fs.length && fs[last + 1]!.timeSec <= endSec + eps) last++;
    return { first, last };
  };
  it('範囲の端がコマの時刻と一致するときは、そのコマを含む', () => {
    expect(frameRange(ten, 1 / 30, 4 / 30)).toEqual({ first: 1, last: 4 });
    expect(frameRange(ten, 0, 9 / 30)).toEqual({ first: 0, last: 9 });
  });
  it('範囲の端がコマの間にあるときは、中に入るコマだけ', () => {
    expect(frameRange(ten, 0.02, 0.15)).toEqual({ first: 1, last: 4 });
  });
  it('動画の外にはみ出す範囲は、端のコマで止まる', () => {
    expect(frameRange(ten, -1, 100)).toEqual({ first: 0, last: 9 });
    expect(frameRange(ten, 100, 200)).toEqual({ first: 9, last: 9 });
  });
  it('範囲にコマがなければ、いちばん近い 1 コマ', () => {
    expect(frameRange(ten, 0.04, 0.05)).toEqual({ first: 2, last: 2 });
    expect(frameRange(ten, 0.05, 0.04)).toEqual({ first: 2, last: 2 }); // 逆向きでも同じ
  });
  it('1 コマだけ・コマなし', () => {
    expect(frameRange([ten[0]!], 0, 1)).toEqual({ first: 0, last: 0 });
    expect(frameRange([], 0, 1)).toEqual({ first: -1, last: -1 });
  });
  it('間隔が一定でないコマ列でも、先頭から数えた結果と一致する', () => {
    // 乱数（再現できるよう、簡単な線形合同法）で間隔の揺れた 200 コマと、範囲 500 組を試す
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    let t = 0;
    const uneven: LandmarkFrame[] = Array.from({ length: 200 }, () => {
      t += 0.02 + rand() * 0.03;
      return { timeSec: t, landmarks: null };
    });
    for (let n = 0; n < 500; n++) {
      const a = rand() * 7 - 0.5;
      const b = rand() * 7 - 0.5;
      // コマの時刻ぴったりも混ぜる
      const startSec = n % 5 === 0 ? uneven[Math.floor(rand() * 200)]!.timeSec : a;
      const endSec = n % 7 === 0 ? uneven[Math.floor(rand() * 200)]!.timeSec : b;
      expect(frameRange(uneven, startSec, endSec)).toEqual(linear(uneven, startSec, endSec));
    }
  });
});
