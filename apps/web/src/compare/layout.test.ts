import {
  applyAffine,
  composeAffine,
  mirrorX,
  rotationAbout,
  scalingAbout,
  translation,
  type Affine,
  type CommonLandmarks,
  type Point,
} from '@pistol-kamae/engine';
import { describe, expect, it } from 'vitest';
import { canNormalize, overlayLayout, sameAspect, sideBySideViews, type PoseSide } from './layout';

const p = (x: number, y: number, visibility = 1): Point => ({ x, y, visibility });
const SIZE = { width: 1000, height: 1000 };

/** まっすぐ立った右利き射手。腰の中心は (500, 400)、体幹の長さは 200 */
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
const moved = (lm: CommonLandmarks, m: Affine): CommonLandmarks =>
  Object.fromEntries(Object.entries(lm).map(([k, q]) => [k, applyAffine(m, q)])) as CommonLandmarks;
const side = (landmarks: CommonLandmarks | null, patch: Partial<PoseSide> = {}): PoseSide => ({
  landmarks,
  size: SIZE,
  tiltDeg: 0,
  handedness: 'right',
  ...patch,
});
/** 基準の全関節を移し替えた位置と、今回の関節の位置の差の最大（画素） */
function maxGap(base: PoseSide, current: PoseSide, m: Affine): number {
  let gap = 0;
  for (const name of Object.keys(current.landmarks!) as Array<keyof CommonLandmarks>) {
    const a = applyAffine(m, base.landmarks![name]);
    const b = current.landmarks![name];
    gap = Math.max(gap, Math.hypot(a.x - b.x, a.y - b.y));
  }
  return gap;
}

describe('overlayLayout：重ね描きの配置', () => {
  it('揃える：位置と大きさが違う同じ姿勢は、ぴったり重なる', () => {
    const shift = composeAffine(translation(120, 60), scalingAbout({ x: 500, y: 400 }, 0.7));
    const base = side(moved(upright(), shift));
    const current = side(upright());
    const layout = overlayLayout(base, current, 'normalized');
    expect(maxGap(base, current, layout.baseTransform)).toBeLessThan(1e-6);
    expect(layout.sizeRatio).toBeCloseTo(1, 9);
    expect(layout.mirrored).toBe(false);
  });

  it('揃える：カメラの傾きが違っても、水平の線で求めた傾きの差の分だけ回して重なる', () => {
    const center = { x: 500, y: 500 };
    const base = side(moved(upright(), rotationAbout(center, 2.5)), { tiltDeg: 2.5 });
    const current = side(moved(upright(), rotationAbout(center, -1)), { tiltDeg: -1 });
    const layout = overlayLayout(base, current, 'normalized');
    expect(maxGap(base, current, layout.baseTransform)).toBeLessThan(1e-6);
  });

  it('揃える：水平の線がなければ回さない（カメラの傾きの差がそのまま残る）', () => {
    const center = { x: 500, y: 500 };
    const base = side(moved(upright(), rotationAbout(center, 2.5)));
    const current = side(upright());
    const layout = overlayLayout(base, current, 'normalized');
    expect(maxGap(base, current, layout.baseTransform)).toBeGreaterThan(5);
  });

  it('揃える：利き手が違えば、基準を左右反転して重ねる', () => {
    // 基準は、今回の姿勢を鏡に映した左利き射手
    const base = side(mirrorX(upright(), 1000), { handedness: 'left' });
    const current = side(upright());
    const layout = overlayLayout(base, current, 'normalized');
    expect(layout.mirrored).toBe(true);
    // 左右反転すると関節の名前も入れ替わるので、手首どうしで確かめる
    const wrist = applyAffine(layout.baseTransform, base.landmarks!.leftWrist);
    expect(wrist.x).toBeCloseTo(current.landmarks!.rightWrist.x, 6);
    expect(wrist.y).toBeCloseTo(current.landmarks!.rightWrist.y, 6);
  });

  it('揃える：左右反転するときは、基準のカメラの傾きも逆向きとして扱う', () => {
    const center = { x: 500, y: 500 };
    // 左利きの基準を、時計回りに 3° 傾いたカメラで撮った
    const base = side(moved(mirrorX(upright(), 1000), rotationAbout(center, 3)), {
      handedness: 'left',
      tiltDeg: 3,
    });
    const current = side(upright());
    const layout = overlayLayout(base, current, 'normalized');
    const wrist = applyAffine(layout.baseTransform, base.landmarks!.leftWrist);
    expect(wrist.x).toBeCloseTo(current.landmarks!.rightWrist.x, 6);
    expect(wrist.y).toBeCloseTo(current.landmarks!.rightWrist.y, 6);
  });

  it('撮ったまま：同じ大きさの動画なら何も動かさない', () => {
    const shift = translation(120, 60);
    const base = side(moved(upright(), shift));
    const layout = overlayLayout(base, side(upright()), 'raw');
    expect(applyAffine(layout.baseTransform, { x: 300, y: 200 })).toEqual({ x: 300, y: 200 });
    expect(layout.sizeRatio).toBeCloseTo(1, 9);
  });

  it('撮ったまま：画素数が違う動画は、画面の幅が合うように拡大・縮小するだけ', () => {
    const half = scalingAbout({ x: 0, y: 0 }, 0.5);
    const base = side(moved(upright(), half), { size: { width: 500, height: 500 } });
    const current = side(upright());
    const layout = overlayLayout(base, current, 'raw');
    expect(maxGap(base, current, layout.baseTransform)).toBeLessThan(1e-6);
  });

  it('撮ったまま：人物の大きさの比が分かる', () => {
    const base = side(moved(upright(), scalingAbout({ x: 500, y: 400 }, 0.88)));
    expect(overlayLayout(base, side(upright()), 'raw').sizeRatio).toBeCloseTo(0.88, 9);
  });

  it('肩や腰が使えない記録があれば、揃えるを選んでも撮ったままの配置になる', () => {
    const hidden = upright();
    hidden.leftHip = p(560, 400, 0.1);
    const base = side(moved(upright(), translation(50, 0)));
    const current = side(hidden);
    expect(canNormalize(base, current)).toBe(false);
    expect(canNormalize(base, side(upright()))).toBe(true);
    expect(canNormalize(side(null), side(upright()))).toBe(false);
    const layout = overlayLayout(base, current, 'normalized');
    expect(applyAffine(layout.baseTransform, { x: 10, y: 20 })).toEqual({ x: 10, y: 20 });
    expect(layout.sizeRatio).toBeNull();
  });

  it('表示範囲は、両方の骨格を含み、余白が付く', () => {
    const base = side(moved(upright(), translation(200, 0)));
    const { view } = overlayLayout(base, side(upright()), 'raw');
    // 骨格は x 100〜820、y 100〜800。長い辺 720 の 15% の余白
    expect(view.x).toBeCloseTo(100 - 108, 6);
    expect(view.y).toBeCloseTo(100 - 108, 6);
    expect(view.width).toBeCloseTo(720 + 216, 6);
    expect(view.height).toBeCloseTo(700 + 216, 6);
  });

  it('人物を検出できていなければ、今回の画像全体を表示する', () => {
    expect(overlayLayout(side(null), side(null), 'normalized').view).toEqual({
      x: 0,
      y: 0,
      width: 1000,
      height: 1000,
    });
  });
});

describe('sameAspect：画面の縦横比', () => {
  it('画素数が違っても比が同じなら同じ', () => {
    expect(sameAspect({ width: 1280, height: 720 }, { width: 1920, height: 1080 })).toBe(true);
    expect(sameAspect({ width: 1280, height: 720 }, { width: 720, height: 1280 })).toBe(false);
    expect(sameAspect({ width: 1280, height: 720 }, { width: 1440, height: 1080 })).toBe(false);
  });
});

describe('sideBySideViews：横に並べるときの範囲', () => {
  it('人物が同じ大きさに見え、腰の中心が枠の同じ位置に来る', () => {
    const shift = composeAffine(translation(100, 50), scalingAbout({ x: 500, y: 400 }, 0.5));
    const base = side(moved(upright(), shift));
    const current = side(upright());
    const views = sideBySideViews(base, current);
    // 基準の人物は半分の大きさなので、枠も半分
    expect(views.base.width).toBeCloseTo(views.current.width / 2, 6);
    expect(views.base.height).toBeCloseTo(views.current.height / 2, 6);
    // 腰の中心の、枠の中での位置（割合）が同じ
    const fx = (v: typeof views.base, hipX: number) => (hipX - v.x) / v.width;
    expect(fx(views.base, 600)).toBeCloseTo(fx(views.current, 500), 6);
  });

  it('姿勢が違えば、両方が収まる広いほうの範囲に合わせる', () => {
    const wide = upright();
    wide.rightWrist = p(20, 200);
    const views = sideBySideViews(side(wide), side(upright()));
    expect(views.base.width).toBeCloseTo(views.current.width, 6);
    expect(views.current.x).toBeLessThan(100 - 108);
  });

  it('揃えられないときは、それぞれ人物に寄せる', () => {
    const views = sideBySideViews(side(null), side(upright()));
    expect(views.base).toEqual({ x: 0, y: 0, width: 1000, height: 1000 });
    expect(views.current.x).toBeCloseTo(100 - 105, 6);
  });
});
