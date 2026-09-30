import type { CommonLandmarks, Rect } from '@pistol-kamae/engine';
import type { StoredImage } from '../db/schema';
import { ja } from '../i18n/ja';
import { skeletonParts, type SkeletonParts } from './skeleton';
import { SkeletonLayer } from './SkeletonLayer';
import { useImageUrl } from './useImageUrl';

interface Props {
  image: StoredImage;
  /** 元の動画の幅・高さ（画素）。関節の位置はこの座標で入っている */
  width: number;
  height: number;
  landmarks: CommonLandmarks | null;
  /** 表示する範囲（元の動画の画素座標）。人物に寄せるときは人物の範囲、全体なら画像全体 */
  view: Rect;
  /** 写真の骨格の描き方。省略時は current（緑の実線）。比較画面で「基準」を単独で出すときは base */
  variant?: 'current' | 'base';
  /** 比較画面で重ねる「基準」の骨格（この画像の座標に移し替え済み）。写真の骨格の下に描く */
  baseParts?: SkeletonParts | null;
  alt?: string;
  testId?: string;
}

/**
 * 保存した静止画に骨格を重ねて表示する。
 * 画像と骨格を 1 つの SVG（拡大しても粗くならない図の形式）に入れ、表示範囲を変えるだけで
 * 両方が同じように拡大されるようにしている。
 */
export function StillView(props: Props) {
  const { image, width, height, landmarks, view, variant = 'current', baseParts } = props;
  const url = useImageUrl(image);
  // 線の太さは表示範囲に合わせる（寄せても画面上の太さが変わらない）
  const scale = Math.max(view.width, view.height) / 1000;
  const parts = landmarks ? skeletonParts(landmarks, { width, height }) : null;

  return (
    <svg
      className="still-box"
      data-testid={props.testId ?? 'still'}
      role="img"
      aria-label={props.alt ?? ja.library.stillAlt}
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
      {baseParts && (
        <SkeletonLayer
          parts={baseParts}
          scale={scale}
          variant="base"
          testId="still-skeleton-base"
        />
      )}
      {parts && (
        <SkeletonLayer parts={parts} scale={scale} variant={variant} testId="still-skeleton" />
      )}
    </svg>
  );
}
