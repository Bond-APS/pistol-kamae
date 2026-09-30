import type { CommonLandmarks, Rect } from '@pistol-kamae/engine';
import type { StoredImage } from '../db/schema';
import { ja } from '../i18n/ja';
import { SKELETON_COLORS, SKELETON_SIZES, skeletonParts } from './skeleton';
import { useImageUrl } from './useImageUrl';

interface Props {
  image: StoredImage;
  /** 元の動画の幅・高さ（画素）。関節の位置はこの座標で入っている */
  width: number;
  height: number;
  landmarks: CommonLandmarks | null;
  /** 表示する範囲（元の動画の画素座標）。人物に寄せるときは人物の範囲、全体なら画像全体 */
  view: Rect;
}

/**
 * 保存した静止画に骨格を重ねて表示する。
 * 画像と骨格を 1 つの SVG（拡大しても粗くならない図の形式）に入れ、表示範囲を変えるだけで
 * 両方が同じように拡大されるようにしている。
 */
export function StillView({ image, width, height, landmarks, view }: Props) {
  const url = useImageUrl(image);
  // 線の太さは表示範囲に合わせる（寄せても画面上の太さが変わらない）
  const scale = Math.max(view.width, view.height) / 1000;
  const parts = landmarks ? skeletonParts(landmarks, { width, height }) : null;
  const color = (usable: boolean) => (usable ? SKELETON_COLORS.usable : SKELETON_COLORS.unusable);

  return (
    <svg
      className="still-box"
      data-testid="still"
      role="img"
      aria-label={ja.library.stillAlt}
      viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
      style={{ aspectRatio: `${view.width} / ${view.height}` }}
    >
      {url && (
        <image
          data-testid="still-image"
          href={url}
          x={0}
          y={0}
          width={width}
          height={height}
          preserveAspectRatio="none"
        />
      )}
      {parts && (
        <g strokeLinecap="round" data-testid="still-skeleton">
          {parts.edges.map((e, i) => (
            <line
              key={`o${i}`}
              x1={e.a.x}
              y1={e.a.y}
              x2={e.b.x}
              y2={e.b.y}
              stroke={SKELETON_COLORS.outline}
              strokeWidth={SKELETON_SIZES.outline * scale}
            />
          ))}
          {parts.edges.map((e, i) => (
            <line
              key={`l${i}`}
              x1={e.a.x}
              y1={e.a.y}
              x2={e.b.x}
              y2={e.b.y}
              stroke={color(e.usable)}
              strokeWidth={SKELETON_SIZES.line * scale}
            />
          ))}
          {parts.points.map(({ p, usable }, i) => (
            <circle
              key={`p${i}`}
              cx={p.x}
              cy={p.y}
              r={SKELETON_SIZES.dot * scale}
              fill={color(usable)}
              stroke={SKELETON_COLORS.outline}
              strokeWidth={(SKELETON_SIZES.dotOutline - SKELETON_SIZES.dot) * scale}
            />
          ))}
        </g>
      )}
    </svg>
  );
}
