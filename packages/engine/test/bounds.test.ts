import { describe, expect, it } from 'vitest';
import { coverRect, expandRect, personBounds } from '../src/landmarks/bounds';
import type { CommonLandmarks, Point } from '../src/landmarks/types';

const p = (x: number, y: number, visibility = 1): Point => ({ x, y, visibility });
const IMAGE = { width: 1280, height: 720 };

/** 横長の画面の中央付近に立つ射手。x は 500〜800、y は 100〜650 に収まる */
function shooter(): CommonLandmarks {
  return {
    nose: p(640, 100),
    rightEar: p(630, 105),
    leftEar: p(650, 105),
    rightShoulder: p(600, 200),
    leftShoulder: p(700, 200),
    rightHip: p(620, 400),
    leftHip: p(690, 400),
    rightWrist: p(500, 190),
    leftWrist: p(800, 380),
    rightAnkle: p(610, 650),
    leftAnkle: p(700, 650),
  };
}

describe('personBounds', () => {
  it('使える点をすべて含む最小の長方形', () => {
    expect(personBounds(shooter(), IMAGE)).toEqual({ x: 500, y: 100, width: 300, height: 550 });
  });

  it('よく見えない点と画面の外の点は含めない', () => {
    const lm = shooter();
    lm.rightWrist = p(500, 190, 0.2); // よく見えない
    lm.rightAnkle = p(610, 760); // 画面の下にはみ出し
    lm.leftAnkle = p(700, 770);
    // 左端は右肩（600）、下端は両腰（400）になる
    expect(personBounds(lm, IMAGE)).toEqual({ x: 600, y: 100, width: 200, height: 300 });
  });

  it('使える点が 2 つ未満なら null', () => {
    const lm = shooter();
    for (const name of Object.keys(lm) as Array<keyof CommonLandmarks>) {
      lm[name] = p(lm[name].x, lm[name].y, 0);
    }
    expect(personBounds(lm, IMAGE)).toBeNull();
    lm.nose = p(640, 100, 1);
    expect(personBounds(lm, IMAGE)).toBeNull();
  });
});

describe('expandRect', () => {
  it('長い辺の割合で四方に広げる', () => {
    // 長い辺 550 の 10% = 55
    expect(expandRect({ x: 500, y: 100, width: 300, height: 550 }, 0.1, IMAGE)).toEqual({
      x: 445,
      y: 45,
      width: 410,
      height: 660,
    });
  });

  it('画像からはみ出した分は切り落とす', () => {
    const r = expandRect({ x: 20, y: 100, width: 300, height: 600 }, 0.1, IMAGE);
    expect(r).toEqual({ x: 0, y: 40, width: 380, height: 680 });
  });
});

describe('coverRect', () => {
  it('指定した縦横比で、元の長方形を中央に含む', () => {
    // 300×400 を 3:4 で → そのまま
    expect(coverRect({ x: 500, y: 100, width: 300, height: 400 }, 3 / 4, IMAGE)).toEqual({
      x: 500,
      y: 100,
      width: 300,
      height: 400,
    });
    // 100×400 を 3:4 で → 幅を 300 に広げ、中央をそろえる
    expect(coverRect({ x: 600, y: 100, width: 100, height: 400 }, 3 / 4, IMAGE)).toEqual({
      x: 500,
      y: 100,
      width: 300,
      height: 400,
    });
  });

  it('画像の端では、はみ出さないよう内側へずらす', () => {
    const r = coverRect({ x: 0, y: 100, width: 100, height: 400 }, 3 / 4, IMAGE);
    expect(r).toEqual({ x: 0, y: 100, width: 300, height: 400 });
  });

  it('画像に入りきらないときは、画像に入る最大の大きさにする', () => {
    // 高さ 720 いっぱいの人物を 3:4 で → 幅 540×高さ 720
    const r = coverRect({ x: 500, y: 0, width: 300, height: 720 }, 3 / 4, IMAGE);
    expect(r.width).toBeCloseTo(540);
    expect(r.height).toBeCloseTo(720);
    expect(r.x).toBeCloseTo(380);
    expect(r.y).toBeCloseTo(0);

    // 人物より広い比（16:9 の画像全体）を求めても画像を超えない
    const wide = coverRect({ x: 0, y: 0, width: 1280, height: 720 }, 3 / 4, IMAGE);
    expect(wide.width).toBeCloseTo(540);
    expect(wide.height).toBeCloseTo(720);
    expect(wide.x).toBeCloseTo(370);
  });
});
