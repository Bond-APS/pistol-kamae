import { SKELETON_COLORS, SKELETON_SIZES, type SkeletonParts } from './skeleton';

interface Props {
  parts: SkeletonParts;
  /** 線の太さの倍率。表示範囲の長い辺 ÷ 1000（寄せても画面上の太さが変わらないようにする） */
  scale: number;
  /** current：今回（緑の実線）、base：基準（桃色の点線・半透明） */
  variant: 'current' | 'base';
  testId: string;
}

/** SVG の中に骨格を描く。縁取りを先に描き、その上に色の線と点を重ねる */
export function SkeletonLayer({ parts, scale, variant, testId }: Props) {
  const base = variant === 'base';
  const main = base ? SKELETON_COLORS.base : SKELETON_COLORS.usable;
  const color = (usable: boolean) => (usable ? main : SKELETON_COLORS.unusable);
  const dash = base
    ? `${SKELETON_SIZES.line * 3 * scale} ${SKELETON_SIZES.line * 2.4 * scale}`
    : '';

  return (
    <g strokeLinecap="round" opacity={base ? 0.85 : 1} data-testid={testId}>
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
          {...(base ? { strokeDasharray: dash } : {})}
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
  );
}
