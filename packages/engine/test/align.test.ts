import { describe, expect, it } from 'vitest';
import { padRect, transformedBounds, unionRect } from '../src/landmarks/bounds';
import type { CommonLandmarks, Point } from '../src/landmarks/types';
import {
  IDENTITY,
  applyAffine,
  composeAffine,
  mirroringX,
  rotationAbout,
  scalingAbout,
  translation,
} from '../src/normalize/affine';
import { alignToAnchor, bodyAnchor, transformAnchor } from '../src/normalize/align';

const p = (x: number, y: number, visibility = 1): Point => ({ x, y, visibility });
const IMAGE = { width: 1000, height: 1000 };

function upright(): CommonLandmarks {
  return {
    nose: p(500, 100),
    rightEar: p(500, 100),
    leftEar: p(520, 100),
    rightShoulder: p(400, 200),
    leftShoulder: p(600, 200),
    rightHip: p(440, 400),
    leftHip: p(560, 400),
    rightWrist: p(100, 200),
    leftWrist: p(620, 500),
    rightAnkle: p(400, 800),
    leftAnkle: p(600, 800),
  };
}
const mapAll = (lm: CommonLandmarks, f: (q: Point) => Point): CommonLandmarks =>
  Object.fromEntries(Object.entries(lm).map(([name, q]) => [name, f(q)])) as CommonLandmarks;

describe('点の移し替え', () => {
  it('回転：正の角度は画面上で時計回り（右へ延びる線の右端が下がる）', () => {
    const q = applyAffine(rotationAbout({ x: 0, y: 0 }, 90), { x: 1, y: 0 });
    expect(q.x).toBeCloseTo(0, 9);
    expect(q.y).toBeCloseTo(1, 9);
    // 中心は動かない
    const c = applyAffine(rotationAbout({ x: 300, y: 200 }, 37), { x: 300, y: 200 });
    expect(c.x).toBeCloseTo(300, 9);
    expect(c.y).toBeCloseTo(200, 9);
  });

  it('拡大・縮小、平行移動、左右反転', () => {
    expect(applyAffine(scalingAbout({ x: 100, y: 100 }, 2), { x: 150, y: 80 })).toEqual({
      x: 200,
      y: 60,
    });
    expect(applyAffine(translation(10, -5), { x: 1, y: 2 })).toEqual({ x: 11, y: -3 });
    expect(applyAffine(mirroringX(1000), { x: 300, y: 50 })).toEqual({ x: 700, y: 50 });
    expect(applyAffine(IDENTITY, { x: 3, y: 4 })).toEqual({ x: 3, y: 4 });
  });

  it('x, y 以外の項目（visibility）は保つ', () => {
    expect(applyAffine(translation(1, 1), p(0, 0, 0.7)).visibility).toBe(0.7);
  });

  it('合成：先に行う移し替えを右に書く', () => {
    const m = composeAffine(translation(100, 0), scalingAbout({ x: 0, y: 0 }, 2));
    expect(applyAffine(m, { x: 10, y: 10 })).toEqual({ x: 120, y: 20 });
  });
});

describe('bodyAnchor：腰の中心と体幹の長さ', () => {
  it('両肩・両腰から求める', () => {
    expect(bodyAnchor(upright(), IMAGE)).toEqual({
      hipCenter: { x: 500, y: 400 },
      trunkLength: 200,
    });
  });

  it('肩や腰がよく見えない・画面の外なら null', () => {
    const hidden = upright();
    hidden.leftHip = p(560, 400, 0.2);
    expect(bodyAnchor(hidden, IMAGE)).toBeNull();
    const outside = upright();
    outside.leftShoulder = p(1010, 200);
    expect(bodyAnchor(outside, IMAGE)).toBeNull();
  });
});

describe('alignToAnchor：2 つの骨格を揃える', () => {
  it('位置と大きさが違う同じ姿勢は、揃えるとぴったり重なる', () => {
    // 基準は、今回の 0.8 倍の大きさで、右下にずれて写っている
    const shift = composeAffine(translation(130, 40), scalingAbout({ x: 500, y: 400 }, 0.8));
    const baseLm = mapAll(upright(), (q) => applyAffine(shift, q));
    const from = bodyAnchor(baseLm, IMAGE)!;
    const to = bodyAnchor(upright(), IMAGE)!;
    expect(from.trunkLength).toBeCloseTo(160, 9);
    const m = alignToAnchor(from, to);
    for (const [name, q] of Object.entries(upright())) {
      const moved = applyAffine(m, baseLm[name as keyof CommonLandmarks]);
      expect(moved.x).toBeCloseTo(q.x, 6);
      expect(moved.y).toBeCloseTo(q.y, 6);
    }
  });

  it('カメラの傾きが違う同じ姿勢も、傾きの差の分だけ回すと重なる', () => {
    // 基準は時計回りに 3° 傾いたカメラ、今回は反時計回りに 1° 傾いたカメラで撮った
    const baseLm = mapAll(upright(), (q) => applyAffine(rotationAbout({ x: 500, y: 500 }, 3), q));
    const curLm = mapAll(upright(), (q) => applyAffine(rotationAbout({ x: 500, y: 500 }, -1), q));
    const m = alignToAnchor(bodyAnchor(baseLm, IMAGE)!, bodyAnchor(curLm, IMAGE)!, -1 - 3);
    for (const name of Object.keys(upright()) as Array<keyof CommonLandmarks>) {
      const moved = applyAffine(m, baseLm[name]);
      expect(moved.x).toBeCloseTo(curLm[name].x, 6);
      expect(moved.y).toBeCloseTo(curLm[name].y, 6);
    }
  });

  it('姿勢が違えば、腰の中心と体幹の長さだけが一致し、ほかの点に差が残る', () => {
    const baseLm = upright();
    baseLm.rightWrist = p(100, 150);
    const m = alignToAnchor(bodyAnchor(baseLm, IMAGE)!, bodyAnchor(upright(), IMAGE)!);
    expect(applyAffine(m, baseLm.rightWrist).y).toBeCloseTo(150, 6);
    expect(applyAffine(m, baseLm.rightHip)).toEqual(upright().rightHip);
  });

  it('左右反転した骨格の手がかりは、反転した位置になる（長さは変わらない）', () => {
    const anchor = bodyAnchor(upright(), IMAGE)!;
    const mirrored = transformAnchor(mirroringX(1000), {
      ...anchor,
      hipCenter: { x: 300, y: 400 },
    });
    expect(mirrored.hipCenter).toEqual({ x: 700, y: 400 });
    expect(mirrored.trunkLength).toBeCloseTo(200, 9);
    expect(transformAnchor(scalingAbout({ x: 0, y: 0 }, 0.5), anchor).trunkLength).toBeCloseTo(
      100,
      9,
    );
  });
});

describe('長方形の計算', () => {
  it('unionRect：両方を含む最小の長方形', () => {
    expect(
      unionRect({ x: 10, y: 20, width: 100, height: 50 }, { x: 60, y: 0, width: 100, height: 40 }),
    ).toEqual({ x: 10, y: 0, width: 150, height: 70 });
  });

  it('padRect：長い辺に対する割合で四方に広げる（画像の外へ出てもよい）', () => {
    expect(padRect({ x: 10, y: 20, width: 100, height: 200 }, 0.1)).toEqual({
      x: -10,
      y: 0,
      width: 140,
      height: 240,
    });
  });

  it('transformedBounds：移し替えたあとの四隅を含む長方形', () => {
    const r = transformedBounds(
      { x: 0, y: 0, width: 100, height: 50 },
      composeAffine(translation(10, 10), scalingAbout({ x: 0, y: 0 }, 2)),
    );
    expect(r).toEqual({ x: 10, y: 10, width: 200, height: 100 });
    const rotated = transformedBounds(
      { x: 0, y: 0, width: 100, height: 50 },
      rotationAbout({ x: 0, y: 0 }, 90),
    );
    expect(rotated.x).toBeCloseTo(-50, 9);
    expect(rotated.width).toBeCloseTo(50, 9);
    expect(rotated.height).toBeCloseTo(100, 9);
  });
});
