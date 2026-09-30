// 平面上の点の移し替え（回転・拡大縮小・平行移動・左右反転）をまとめて表す。
// 水平校正（カメラの傾きの補正）と、2 つの骨格を重ねるときの位置合わせに使う。

/** 画像上の位置（画素）。x は右向き、y は下向きが正 */
export interface Vec2 {
  x: number;
  y: number;
}

/**
 * 点の移し替え。x' = a·x + c·y + e、y' = b·x + d·y + f。
 * SVG の matrix(a, b, c, d, e, f) と同じ並び。
 */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/** 何も動かさない */
export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function applyAffine<T extends Vec2>(m: Affine, p: T): T {
  return { ...p, x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

/** first を行ってから second を行う移し替え */
export function composeAffine(second: Affine, first: Affine): Affine {
  return {
    a: second.a * first.a + second.c * first.b,
    b: second.b * first.a + second.d * first.b,
    c: second.a * first.c + second.c * first.d,
    d: second.b * first.c + second.d * first.d,
    e: second.a * first.e + second.c * first.f + second.e,
    f: second.b * first.e + second.d * first.f + second.f,
  };
}

export function translation(dx: number, dy: number): Affine {
  return { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy };
}

/**
 * center を中心に deg 度まわす。
 * 画像は y が下向きなので、正の角度は画面上で時計回り（右へ延びる線の右端が下がる向き）。
 */
export function rotationAbout(center: Vec2, deg: number): Affine {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    a: cos,
    b: sin,
    c: -sin,
    d: cos,
    e: center.x - cos * center.x + sin * center.y,
    f: center.y - sin * center.x - cos * center.y,
  };
}

/** center を中心に factor 倍に拡大・縮小する */
export function scalingAbout(center: Vec2, factor: number): Affine {
  return {
    a: factor,
    b: 0,
    c: 0,
    d: factor,
    e: center.x * (1 - factor),
    f: center.y * (1 - factor),
  };
}

/** 幅 imageWidth の画像を左右反転する */
export function mirroringX(imageWidth: number): Affine {
  return { a: -1, b: 0, c: 0, d: 1, e: imageWidth, f: 0 };
}
