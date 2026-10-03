import { IDENTITY, type LandmarkFrame, type RecordAnalysis } from '@pistol-kamae/engine';
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { frameRange, nearestFrameInRange, seekTimeForFrame } from '../analysis/frames';
import { ja } from '../i18n/ja';
import { usePlayback, type PlaybackVideo } from '../video/usePlayback';
import { CompareStage } from './CompareStage';
import { skeletonParts } from './skeleton';
import { SkeletonLayer } from './SkeletonLayer';
import { TransportControls, type Transport } from './TransportControls';
import { WaveBar, type BarMarker, type ClipHandles, type WaveSeries } from './WaveBar';

export type SingleAnalysis = Pick<
  RecordAnalysis,
  'frames' | 'width' | 'height' | 'fps' | 'durationSec'
>;

interface Props {
  videoUrl: string;
  analysis: SingleAnalysis;
  /** バーの範囲（動画の時刻、秒）。切り抜きの範囲、または範囲を決めるときは動画の全体 */
  startSec: number;
  endSec: number;
  /** 表示中の時刻（秒）。親が持つ */
  valueSec: number;
  onChange: (sec: number) => void;
  waves?: WaveSeries[];
  noAudio?: boolean;
  markers?: BarMarker[];
  handles?: ClipHandles;
  /** つまみの形（切り抜きと撃発ポイントの画面では ▲） */
  pointer?: 'arrow';
  /** 速さと繰り返し。渡さなければ ◀1 コマ／▶ 再生／1 コマ▶ だけ */
  transport?: Transport;
  /** 時刻の表示（つまみの位置の説明）。撃発からの秒数など */
  timeLabel: string;
  showSkeleton?: boolean;
  /** 静止画を撮るなどのために、置かれた video 要素を知らせる */
  onVideo?: (video: HTMLVideoElement | null) => void;
  /** 再生中かどうかが変わったとき（止めているときだけ角度表を出す、などに使う） */
  onPlayingChange?: (playing: boolean) => void;
  /** 画面に出ているか。別のタブへ移って隠れたら再生を止める */
  active?: boolean;
  testId: string;
  /** バーと操作の間に出すもの */
  children?: ReactNode;
}

/**
 * 1 本の動画を、骨格を重ねて表示するプレイヤー。バー（音のグラフ付き）と再生の操作を持つ。
 * 保存の流れ（切り抜き・撃発ポイント）と、ライブラリの「動画を再生」「撃発ポイントの修正」「切り抜き範囲の修正」で使う。
 */
export function SinglePlayer(props: Props) {
  const { videoUrl, analysis, startSec, endSec, valueSec, onChange, transport, onVideo } = props;
  const { onPlayingChange } = props;
  const { frames, width, height, fps } = analysis;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const setVideo = useCallback(
    (el: HTMLVideoElement | null) => {
      videoRef.current = el;
      onVideo?.(el);
    },
    [onVideo],
  );

  // 表示するコマは、必ずバーの範囲の中から選ぶ（範囲の端は半コマ外のコマを指すことがあるため）
  const range = frameRange(frames, startSec, endSec);
  const index = nearestFrameInRange(frames, valueSec, startSec, endSec);
  const stepSec = 1 / fps;
  const videos = useMemo<PlaybackVideo[]>(
    () => [{ get: () => videoRef.current, anchorSec: 0, fps }],
    [fps],
  );
  const playback = usePlayback({
    videos,
    startT: startSec,
    endT: endSec,
    rate: transport?.rate ?? 1,
    loop: transport?.loop ?? false,
    onTick: onChange,
  });
  useEffect(() => {
    onPlayingChange?.(playback.playing);
  }, [playback.playing, onPlayingChange]);
  const { active = true } = props;
  const { pause: pausePlayback } = playback;
  useEffect(() => {
    if (!active) pausePlayback();
  }, [active, pausePlayback]);

  const clamp = (sec: number) => Math.min(Math.max(sec, startSec), endSec);
  const select = (sec: number) => {
    if (playback.playing) playback.pause();
    onChange(clamp(sec));
  };
  const step = (delta: number) => {
    const next = frames[Math.min(Math.max(index + delta, range.first), range.last)];
    if (next) select(next.timeSec);
  };

  const view = { x: 0, y: 0, width, height };
  const landmarks = frames[index]?.landmarks;
  const layer = {
    key: 'single',
    size: { width, height },
    transform: IDENTITY,
    videoUrl,
    // 再生中は動画の進みに任せる。止まっているときは、そのコマを確実に出す時刻へ移す
    timeSec: seekTimeForFrame(frames as LandmarkFrame[], index, fps),
    still: null,
    opacity: 1,
    onVideo: setVideo,
  };

  return (
    <div className="single-player" data-testid={props.testId} data-frame-index={index}>
      <CompareStage
        view={view}
        layers={[layer]}
        label={ja.player.stageAlt}
        testId={`${props.testId}-stage`}
      >
        {props.showSkeleton !== false && landmarks && (
          <SkeletonLayer
            parts={skeletonParts(landmarks, { width, height }, IDENTITY)}
            scale={Math.max(width, height) / 1000}
            variant="current"
            testId={`${props.testId}-skeleton`}
          />
        )}
      </CompareStage>
      <p className="muted small num player-time" data-testid={`${props.testId}-label`}>
        {props.timeLabel}
        {frames[index] && !landmarks ? ` — ${ja.player.noPerson}` : ''}
      </p>
      <WaveBar
        startSec={startSec}
        endSec={endSec}
        valueSec={valueSec}
        stepSec={stepSec}
        onChange={select}
        {...(props.waves ? { waves: props.waves } : {})}
        {...(props.noAudio ? { noAudio: true } : {})}
        {...(props.markers ? { markers: props.markers } : {})}
        {...(props.handles ? { handles: props.handles } : {})}
        {...(props.pointer ? { pointer: props.pointer } : {})}
        startLabel={ja.player.secLabel(startSec)}
        endLabel={ja.player.secLabel(endSec)}
        ariaLabel={ja.player.slider}
        testId={`${props.testId}-bar`}
      />
      <TransportControls
        playing={playback.playing}
        onPlay={() => playback.play()}
        onPause={playback.pause}
        onPrev={() => step(-1)}
        onNext={() => step(1)}
        canPrev={index > range.first}
        canNext={index < range.last}
        canPlay={endSec - startSec >= stepSec}
        {...(transport ? { transport } : {})}
        testId={props.testId}
      />
      {props.children}
    </div>
  );
}
