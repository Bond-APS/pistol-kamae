import {
  checkLevelLine,
  levelInfo,
  type ImageSize,
  type LevelLine,
  type Vec2,
} from '@pistol-kamae/engine';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { StoredImage } from '../db/schema';
import { ja } from '../i18n/ja';
import { Dialog } from './Dialog';
import { useImageUrl } from './useImageUrl';

interface Props {
  /** 撃発フレームの静止画 */
  image: StoredImage;
  /** 元の動画の大きさ（画素）。線の位置はこの座標で持つ */
  size: ImageSize;
  /** いま保存されている線。なければ null */
  initial: LevelLine | null;
  /** 射手の左右の位置（腰の中心の x、画素）。鉛直の線が射手から離れているときに注意を出す。不明なら null */
  personX: number | null;
  /** 線を保存する（null は線を消す）。失敗したら例外を投げる */
  onSave: (line: LevelLine | null) => Promise<void>;
  onCancel: () => void;
}

/** 線の端の番号 */
type End = 1 | 2;

/** 画面上の大きさ（CSS の px）。指で押しやすい大きさにする */
const GRAB_RADIUS_PX = 22;
/** つまみは、指で線の端が隠れないよう、端よりこれだけ下に置く */
const GRAB_OFFSET_PX = 36;
const LOUPE_RADIUS_PX = 46;
/** 拡大鏡の倍率 */
const LOUPE_ZOOM = 4;
/** つまみを置くために、写真の下に足す余白（長い辺に対する割合） */
const BOTTOM_MARGIN_RATIO = 0.17;
/**
 * 鉛直の線が射手からこれ以上離れていたら注意を出す（長い辺に対する割合）。
 * カメラが上や下を向いていると、鉛直なものは画面の中心から離れるほど斜めに写る
 * （ユーザー候補の動画 6 本では、100 画素離れるごとに 0.6〜1.0° ずれていた）。
 */
const FAR_FROM_PERSON_RATIO = 0.15;
const LINE_COLOR = 'var(--level-line)';
const OUTLINE = 'rgba(0, 0, 0, 0.7)';

/** 線がまだないときの最初の位置：画面の下のほうに、水平に */
const defaultLine = (size: ImageSize): LevelLine => ({
  x1: size.width * 0.2,
  y1: size.height * 0.85,
  x2: size.width * 0.8,
  y2: size.height * 0.85,
});

const endOf = (line: LevelLine, end: End): Vec2 =>
  end === 1 ? { x: line.x1, y: line.y1 } : { x: line.x2, y: line.y2 };

const clamp = (v: number, max: number): number => Math.min(Math.max(v, 0), max);

/**
 * 水平の線を引く画面（全画面の窓）。
 * 静止画の上の線の両端を指で動かし、本当は水平（または鉛直）なものに合わせてもらう。
 * 動かしている端の周りを拡大鏡に出す。
 */
export function LevelEditor({ image, size, initial, personX, onSave, onCancel }: Props) {
  const url = useImageUrl(image);
  const clipId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [line, setLine] = useState<LevelLine>(initial ?? defaultLine(size));
  const [active, setActive] = useState<End>(1);
  /** 画像の 1 画素が画面上で何 px か。つまみや拡大鏡を、画面上で決まった大きさに描くのに使う */
  const [pxPerUnit, setPxPerUnit] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  /** 動かしている最中の端と、指の位置から端までのずれ */
  const drag = useRef<{ end: End; dx: number; dy: number } | null>(null);

  const margin = Math.max(size.width, size.height) * BOTTOM_MARGIN_RATIO;
  const viewHeight = size.height + margin;

  // 表示の大きさが変わったら、画面上の縮尺を測り直す
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const measure = () => setPxPerUnit(svg.getScreenCTM()?.a ?? 0);
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  const toImagePoint = (e: ReactPointerEvent): Vec2 | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const point = svg.createSVGPoint();
    point.x = e.clientX;
    point.y = e.clientY;
    const p = point.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };
  const moveEnd = (end: End, to: Vec2) => {
    const x = clamp(to.x, size.width);
    const y = clamp(to.y, size.height);
    setLine((l) => (end === 1 ? { ...l, x1: x, y1: y } : { ...l, x2: x, y2: y }));
  };

  const onPointerDown = (end: End) => (e: ReactPointerEvent<SVGCircleElement>) => {
    const p = toImagePoint(e);
    if (!p) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const at = endOf(line, end);
    drag.current = { end, dx: at.x - p.x, dy: at.y - p.y };
    setActive(end);
  };
  const onPointerMove = (e: ReactPointerEvent<SVGCircleElement>) => {
    const d = drag.current;
    const p = d ? toImagePoint(e) : null;
    if (d && p) moveEnd(d.end, { x: p.x + d.dx, y: p.y + d.dy });
  };
  const onPointerEnd = () => {
    drag.current = null;
  };
  // 矢印キーで 1 画素ずつ（Shift を押しながらで 10 画素ずつ）動かせる
  const onKeyDown = (end: End) => (e: ReactKeyboardEvent<SVGCircleElement>) => {
    const step = e.shiftKey ? 10 : 1;
    const delta: Record<string, Vec2> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    const d = delta[e.key];
    if (!d) return;
    e.preventDefault();
    const at = endOf(line, end);
    setActive(end);
    moveEnd(end, { x: at.x + d.x, y: at.y + d.y });
  };

  const info = levelInfo(line);
  const problem = checkLevelLine(line, size);
  const far =
    problem === null &&
    info?.kind === 'vertical' &&
    personX !== null &&
    Math.abs((line.x1 + line.x2) / 2 - personX) >
      Math.max(size.width, size.height) * FAR_FROM_PERSON_RATIO;
  const save = async (value: LevelLine | null) => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await onSave(value);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  // 画面上で決まった大きさになるよう、px を画像の画素に直す
  const unit = pxPerUnit > 0 ? 1 / pxPerUnit : Math.max(size.width, size.height) / 360;
  const grabR = GRAB_RADIUS_PX * unit;
  // つまみが下の余白からはみ出さないようにする
  const grabOffset = Math.min(GRAB_OFFSET_PX * unit, Math.max(margin - grabR, 0));
  const loupeR = Math.min(LOUPE_RADIUS_PX * unit, Math.min(size.width, size.height) / 4);
  const focus = endOf(line, active);
  // 拡大鏡は、動かしている端と反対側の上の隅に出す（端が上のほうにあるときは下の隅）
  const loupe: Vec2 = {
    x: focus.x < size.width / 2 ? size.width - loupeR * 1.15 : loupeR * 1.15,
    y: focus.y < size.height * 0.45 ? size.height - loupeR * 1.15 : loupeR * 1.15,
  };
  const span = loupeR / LOUPE_ZOOM;
  const lineWidth = 2 * unit;

  return (
    <Dialog
      variant="sheet"
      title={ja.level.title}
      onCancel={() => {
        if (!busy) onCancel();
      }}
      testId="level-editor"
    >
      <p className="small">{ja.level.intro}</p>
      <svg
        ref={svgRef}
        className="level-box"
        data-testid="level-svg"
        role="img"
        aria-label={ja.level.imageAlt}
        viewBox={`0 0 ${size.width} ${viewHeight}`}
        style={{ aspectRatio: `${size.width} / ${viewHeight}` }}
      >
        {url && (
          <image
            href={url}
            x={0}
            y={0}
            width={size.width}
            height={size.height}
            preserveAspectRatio="none"
          />
        )}
        <g strokeLinecap="round">
          <line
            x1={line.x1}
            y1={line.y1}
            x2={line.x2}
            y2={line.y2}
            stroke={OUTLINE}
            strokeWidth={lineWidth * 2}
          />
          <line
            data-testid="level-line"
            x1={line.x1}
            y1={line.y1}
            x2={line.x2}
            y2={line.y2}
            stroke={LINE_COLOR}
            strokeWidth={lineWidth}
          />
        </g>

        {/* 拡大鏡：動かしている端の周りを大きく見せる。線は細くして、合わせる相手が隠れないようにする */}
        <clipPath id={clipId}>
          <circle cx={loupe.x} cy={loupe.y} r={loupeR} />
        </clipPath>
        <g clipPath={`url(#${clipId})`} data-testid="level-loupe" pointerEvents="none">
          <circle cx={loupe.x} cy={loupe.y} r={loupeR} fill="#000" />
          <svg
            x={loupe.x - loupeR}
            y={loupe.y - loupeR}
            width={loupeR * 2}
            height={loupeR * 2}
            viewBox={`${focus.x - span} ${focus.y - span} ${span * 2} ${span * 2}`}
          >
            {url && (
              <image
                href={url}
                x={0}
                y={0}
                width={size.width}
                height={size.height}
                preserveAspectRatio="none"
              />
            )}
            <line
              x1={line.x1}
              y1={line.y1}
              x2={line.x2}
              y2={line.y2}
              stroke={LINE_COLOR}
              strokeWidth={lineWidth / LOUPE_ZOOM}
            />
          </svg>
        </g>
        {/* 拡大鏡の枠と、中心（線の端の位置）を示す細い十字。中心は空けて、端の位置が隠れないようにする */}
        <g fill="none" stroke="#fff" strokeWidth={lineWidth * 0.5} pointerEvents="none">
          <circle cx={loupe.x} cy={loupe.y} r={loupeR} strokeWidth={lineWidth} />
          <line x1={loupe.x - loupeR} y1={loupe.y} x2={loupe.x - loupeR * 0.2} y2={loupe.y} />
          <line x1={loupe.x + loupeR * 0.2} y1={loupe.y} x2={loupe.x + loupeR} y2={loupe.y} />
          <line x1={loupe.x} y1={loupe.y - loupeR} x2={loupe.x} y2={loupe.y - loupeR * 0.2} />
          <line x1={loupe.x} y1={loupe.y + loupeR * 0.2} x2={loupe.x} y2={loupe.y + loupeR} />
        </g>

        {/* 端のつまみ。指で端が隠れないよう、端より下を持つ */}
        {([1, 2] as const).map((end) => {
          const at = endOf(line, end);
          return (
            <g key={end}>
              <line
                x1={at.x}
                y1={at.y}
                x2={at.x}
                y2={at.y + grabOffset}
                stroke={LINE_COLOR}
                strokeWidth={lineWidth * 0.75}
              />
              <circle
                cx={at.x}
                cy={at.y}
                r={3 * unit}
                fill={LINE_COLOR}
                stroke={OUTLINE}
                strokeWidth={unit}
              />
              <circle
                className="level-grab"
                data-testid={`level-handle-${end}`}
                data-x={at.x}
                data-y={at.y}
                role="slider"
                tabIndex={0}
                aria-label={ja.level.handle(end)}
                aria-valuetext={`${Math.round(at.x)}, ${Math.round(at.y)}`}
                cx={at.x}
                cy={at.y + grabOffset}
                r={grabR}
                fill={LINE_COLOR}
                fillOpacity={end === active ? 0.95 : 0.6}
                stroke={OUTLINE}
                strokeWidth={1.5 * unit}
                onPointerDown={onPointerDown(end)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerEnd}
                onPointerCancel={onPointerEnd}
                onKeyDown={onKeyDown(end)}
              />
            </g>
          );
        })}
      </svg>

      {info && (
        <>
          <p
            className="level-readout num"
            data-testid="level-readout"
            data-tilt={info.tiltDeg}
            data-kind={info.kind}
          >
            {ja.level.readout(info.kind, info.tiltDeg)}
          </p>
          <p className="muted small">
            {info.kind === 'horizontal' ? ja.level.kindHorizontal : ja.level.kindVertical}
            {problem === null && ja.level.saveNote}
          </p>
        </>
      )}
      {problem === 'tooShort' && (
        <div className="notice err" data-testid="level-too-short">
          <strong>{ja.level.tooShortTitle}</strong>
          <p className="small">{ja.level.tooShortBody}</p>
        </div>
      )}
      {problem === 'tooTilted' && info && (
        <div className="notice err" data-testid="level-too-tilted">
          <strong>{ja.level.tooTiltedTitle(info.tiltDeg)}</strong>
          <p className="small">{ja.level.tooTiltedBody}</p>
        </div>
      )}
      {far && (
        <div className="notice" data-testid="level-far">
          <strong>{ja.level.farTitle}</strong>
          <p className="small">{ja.level.farBody}</p>
        </div>
      )}
      {failed && (
        <p className="danger small" data-testid="level-failed">
          {ja.level.failed}
        </p>
      )}

      <div className="row nowrap">
        <button type="button" data-testid="level-cancel" disabled={busy} onClick={onCancel}>
          {ja.common.cancel}
        </button>
        <button
          type="button"
          className="primary grow"
          data-testid="level-submit"
          disabled={busy || problem !== null}
          onClick={() => void save(line)}
        >
          {busy ? ja.level.saving : ja.level.submit}
        </button>
      </div>

      {initial && (
        <>
          <div className="gap-action" />
          <button
            type="button"
            className="danger"
            data-testid="level-remove"
            disabled={busy}
            onClick={() => void save(null)}
          >
            {ja.level.remove}
          </button>
        </>
      )}
    </Dialog>
  );
}
