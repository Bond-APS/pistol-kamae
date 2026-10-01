import { composeAffine, type Affine, type ImageSize, type Rect } from '@pistol-kamae/engine';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type { StoredImage } from '../db/schema';
import { useImageUrl } from './useImageUrl';

/** 枠の中に重ねる 1 枚（基準または今回の動画） */
export interface StageLayer {
  key: string;
  /** 動画の大きさ（画素） */
  size: ImageSize;
  /** 動画の画素座標を、枠の座標（view と同じ座標）へ移す移し替え */
  transform: Affine;
  /** 動画本体の一時的な URL。動画のない記録は null */
  videoUrl: string | null;
  /** 表示する時刻（秒）。動画を止めて、この時刻の絵を出す */
  timeSec: number;
  /** 動画のない記録で、代わりに出す静止画（撃発の瞬間だけ）。出さないときは null */
  still: StoredImage | null;
  /** 濃さ（0〜1） */
  opacity: number;
  /** 再生・停止のために、置かれた video 要素を知らせる（外れたら null） */
  onVideo: (video: HTMLVideoElement | null) => void;
}

interface Props {
  /** 表示する範囲（枠の座標） */
  view: Rect;
  /** 下から順に重ねる */
  layers: StageLayer[];
  /** 押している間・離したときを知らせる（押している間だけ基準を表示する切替に使う） */
  onHold?: (holding: boolean) => void;
  label: string;
  testId: string;
  /** 骨格など、動画の上に重ねる SVG の中身 */
  children: ReactNode;
}

/** シーク先との差がこれ未満なら、動かさない（同じ時刻への無駄なシークを避ける） */
const SEEK_EPSILON_SEC = 0.001;

function LayerVideo({ layer }: { layer: StageLayer }) {
  const { videoUrl, timeSec, onVideo } = layer;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const setVideo = useCallback(
    (el: HTMLVideoElement | null) => {
      videoRef.current = el;
      onVideo(el);
    },
    [onVideo],
  );
  // 止まっているときだけ、指定の時刻へ移す（再生中は動画の進みに任せる）
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !video.paused || video.readyState === 0) return;
    if (Math.abs(video.currentTime - timeSec) > SEEK_EPSILON_SEC) video.currentTime = timeSec;
  }, [timeSec, videoUrl]);
  // iPhone の Safari は、明示的に load() を呼ばないと読み始めないことがある
  useEffect(() => {
    videoRef.current?.load();
  }, [videoUrl]);

  if (!videoUrl) return null;
  return (
    <video
      ref={setVideo}
      src={videoUrl}
      muted
      playsInline
      preload="auto"
      data-testid={`stage-video-${layer.key}`}
      // 最初の絵を出す。Safari（WebKit）は、メタ情報が読めた時点（loadedmetadata）で時刻を移しても
      // 絵が出ず黒いままになるので、最初のフレームが読めてから（loadeddata）移す
      onLoadedData={(e) => {
        e.currentTarget.currentTime = timeSec;
      }}
    />
  );
}

function LayerStill({ image, testId }: { image: StoredImage; testId: string }) {
  const url = useImageUrl(image);
  return url ? <img src={url} alt="" data-testid={testId} draggable={false} /> : null;
}

/**
 * 動画（または静止画）を重ねて表示する枠。
 * それぞれの動画を、位置合わせの移し替えと表示範囲に合わせて CSS で拡大・移動し、その上に SVG（骨格）を重ねる。
 * video 要素は、一度置いたら別の場所へ動かさない（Safari は動かすとシークが終わらなくなる）。
 */
export function CompareStage({ view, layers, onHold, label, testId, children }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  /** 枠の画面上の幅（px）。表示範囲の 1 画素が画面上で何 px かを決める */
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(() => setWidth(box.clientWidth));
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const k = width / view.width;
  // 枠の座標 → 画面上の px
  const toScreen: Affine = { a: k, b: 0, c: 0, d: k, e: -view.x * k, f: -view.y * k };
  const hold = (holding: boolean) => (e: ReactPointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    onHold?.(holding);
  };

  return (
    <div
      ref={boxRef}
      className="stage"
      data-testid={testId}
      style={{
        aspectRatio: `${view.width} / ${view.height}`,
        // 縦長の範囲でも画面からはみ出さないよう、高さの上限に合わせて幅を狭める
        width: `min(100%, calc(60vh * ${view.width / view.height}))`,
      }}
      onPointerDown={hold(true)}
      onPointerUp={hold(false)}
      onPointerCancel={hold(false)}
      onPointerLeave={hold(false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {width > 0 &&
        layers.map((layer) => {
          const m = composeAffine(toScreen, layer.transform);
          return (
            <div
              key={layer.key}
              className="stage-layer"
              data-testid={`stage-layer-${layer.key}`}
              style={{
                width: layer.size.width,
                height: layer.size.height,
                opacity: layer.opacity,
                transform: `matrix(${m.a}, ${m.b}, ${m.c}, ${m.d}, ${m.e}, ${m.f})`,
              }}
            >
              <LayerVideo layer={layer} />
              {!layer.videoUrl && layer.still && (
                <LayerStill image={layer.still} testId={`stage-still-${layer.key}`} />
              )}
            </div>
          );
        })}
      <svg
        className="stage-svg"
        data-testid={`${testId}-svg`}
        role="img"
        aria-label={label}
        viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
      >
        {children}
      </svg>
    </div>
  );
}
