// 比較画面の図の配置（画面から切り離した計算だけの部分）。
// 「基準」の骨格を「今回」の画像のどこに描くか、どの範囲を表示するかを決める。

import {
  IDENTITY,
  alignToAnchor,
  bodyAnchor,
  composeAffine,
  mirroringX,
  padRect,
  personBounds,
  scalingAbout,
  transformAnchor,
  transformedBounds,
  unionRect,
  type Affine,
  type BodyAnchor,
  type CommonLandmarks,
  type Handedness,
  type ImageSize,
  type Rect,
} from '@pistol-kamae/engine';

/** 比べる片方（基準または今回）の、撃発の瞬間の姿勢 */
export interface PoseSide {
  /** 撃発フレームの関節の位置。人物を検出できていなければ null */
  landmarks: CommonLandmarks | null;
  /** 動画の大きさ（画素） */
  size: ImageSize;
  /** カメラの傾き（度）。水平の線がなければ 0 */
  tiltDeg: number;
  handedness: Handedness;
}

/** normalized：位置と大きさを揃える、raw：撮ったまま */
export type AlignMode = 'normalized' | 'raw';

/** 骨格のまわりに足す余白（長い辺に対する割合）。関節の点は体の輪郭より内側にあるため */
const VIEW_MARGIN = 0.15;
/** 縦横比が同じとみなす誤差 */
const ASPECT_TOLERANCE = 0.01;

const wholeOf = (size: ImageSize): Rect => ({ x: 0, y: 0, width: size.width, height: size.height });

const anchorOf = (side: PoseSide): BodyAnchor | null =>
  side.landmarks ? bodyAnchor(side.landmarks, side.size) : null;

/** 位置と大きさを揃えられるか（どちらも両肩・両腰が使えること） */
export function canNormalize(base: PoseSide, current: PoseSide): boolean {
  return anchorOf(base) !== null && anchorOf(current) !== null;
}

/** 画面の縦横比が同じか（違うと「撮ったまま」では重ねられない） */
export function sameAspect(a: ImageSize, b: ImageSize): boolean {
  const ra = a.width / a.height;
  const rb = b.width / b.height;
  return Math.abs(ra - rb) <= ASPECT_TOLERANCE * Math.max(ra, rb);
}

export interface OverlayLayout {
  /** 基準の骨格を「今回」の画像の座標へ移す移し替え */
  baseTransform: Affine;
  /** 表示する範囲（今回の画像の座標）。画像の外へはみ出すことがある */
  view: Rect;
  /** 基準の骨格を左右反転したか（利き手が違う 2 件を揃えるとき） */
  mirrored: boolean;
  /** 重ねた状態での人物の大きさの比（基準 ÷ 今回）。求められなければ null。揃えたときは 1 */
  sizeRatio: number | null;
}

/**
 * 重ね描きの配置。
 * normalized：腰の中心を重ね、体幹の長さを同じにする。カメラの傾きの差の分だけ回し、
 *             利き手が違えば基準を左右反転する。
 * raw：画面の中の位置と大きさをそのまま重ねる（動画の画素数が違えば、画面の幅が合うように拡大・縮小するだけ）。
 * 揃えられない（肩や腰が使えない）ときは、normalized を指定しても raw と同じ配置になる。
 */
export function overlayLayout(base: PoseSide, current: PoseSide, mode: AlignMode): OverlayLayout {
  const baseAnchor = anchorOf(base);
  const currentAnchor = anchorOf(current);
  const fit = scalingAbout({ x: 0, y: 0 }, current.size.width / base.size.width);

  let baseTransform = fit;
  let mirrored = false;
  if (mode === 'normalized' && baseAnchor && currentAnchor) {
    mirrored = base.handedness !== current.handedness;
    const mirror = mirrored ? mirroringX(base.size.width) : IDENTITY;
    // 左右反転すると、カメラの傾きの向きも逆になる
    const baseTilt = mirrored ? -base.tiltDeg : base.tiltDeg;
    const align = alignToAnchor(
      transformAnchor(mirror, baseAnchor),
      currentAnchor,
      current.tiltDeg - baseTilt,
    );
    baseTransform = composeAffine(align, mirror);
  }

  const movedAnchor = baseAnchor ? transformAnchor(baseTransform, baseAnchor) : null;
  const sizeRatio =
    movedAnchor && currentAnchor ? movedAnchor.trunkLength / currentAnchor.trunkLength : null;

  const currentBounds = current.landmarks ? personBounds(current.landmarks, current.size) : null;
  const baseBounds = base.landmarks ? personBounds(base.landmarks, base.size) : null;
  const movedBounds = baseBounds ? transformedBounds(baseBounds, baseTransform) : null;
  const bounds =
    currentBounds && movedBounds
      ? unionRect(currentBounds, movedBounds)
      : (currentBounds ?? movedBounds);
  const view = bounds ? padRect(bounds, VIEW_MARGIN) : wholeOf(current.size);

  return { baseTransform, view, mirrored, sizeRatio };
}

/** 人物の範囲が、腰の中心から四方へ体幹の長さの何倍まで広がっているか */
interface Extents {
  left: number;
  right: number;
  up: number;
  down: number;
}

function extentsOf(side: PoseSide, anchor: BodyAnchor): Extents | null {
  const bounds = side.landmarks ? personBounds(side.landmarks, side.size) : null;
  if (!bounds) return null;
  const rect = padRect(bounds, VIEW_MARGIN);
  const { hipCenter, trunkLength } = anchor;
  return {
    left: (hipCenter.x - rect.x) / trunkLength,
    right: (rect.x + rect.width - hipCenter.x) / trunkLength,
    up: (hipCenter.y - rect.y) / trunkLength,
    down: (rect.y + rect.height - hipCenter.y) / trunkLength,
  };
}

/** 人物に寄せた範囲（余白付き）。人物を検出できていなければ画像全体 */
function personView(side: PoseSide): Rect {
  const bounds = side.landmarks ? personBounds(side.landmarks, side.size) : null;
  return bounds ? padRect(bounds, VIEW_MARGIN) : wholeOf(side.size);
}

/**
 * 横に並べるときの、それぞれの表示範囲（それぞれの画像の座標）。
 * 2 枚とも、腰の中心が枠の同じ位置に来て、人物が同じ大きさに見えるようにする
 * （枠の大きさを、それぞれの体幹の長さに比例させる）。揃えられないときは、それぞれ人物に寄せるだけ。
 */
export function sideBySideViews(base: PoseSide, current: PoseSide): { base: Rect; current: Rect } {
  const baseAnchor = anchorOf(base);
  const currentAnchor = anchorOf(current);
  const baseExtents = baseAnchor ? extentsOf(base, baseAnchor) : null;
  const currentExtents = currentAnchor ? extentsOf(current, currentAnchor) : null;
  if (!baseAnchor || !currentAnchor || !baseExtents || !currentExtents) {
    return { base: personView(base), current: personView(current) };
  }
  const extents: Extents = {
    left: Math.max(baseExtents.left, currentExtents.left),
    right: Math.max(baseExtents.right, currentExtents.right),
    up: Math.max(baseExtents.up, currentExtents.up),
    down: Math.max(baseExtents.down, currentExtents.down),
  };
  const viewOf = ({ hipCenter, trunkLength }: BodyAnchor): Rect => ({
    x: hipCenter.x - extents.left * trunkLength,
    y: hipCenter.y - extents.up * trunkLength,
    width: (extents.left + extents.right) * trunkLength,
    height: (extents.up + extents.down) * trunkLength,
  });
  return { base: viewOf(baseAnchor), current: viewOf(currentAnchor) };
}
