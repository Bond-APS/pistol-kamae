import { useCallback, useEffect, useState, type RefObject } from 'react';
import type { AnalysisResult } from '../analysis/runAnalysis';
import { ja } from '../i18n/ja';
import { showFrame } from '../video/showFrame';
import { SkeletonOverlay } from './SkeletonOverlay';

interface Props {
  /** 読込画面が作った video 要素。React の管理外なので ref で受け取る */
  videoRef: RefObject<HTMLVideoElement | null>;
  result: AnalysisResult;
  /** 表示中のフレーム番号が変わったときに知らせる */
  onFrameIndex?: (index: number) => void;
}

/** 推定結果を重ねた動画プレイヤー。再生・一時停止・1 コマ送り・スライダー */
export function VideoPlayer({ videoRef, result, onFrameIndex }: Props) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [frameIndex, setFrameIndex] = useState(0);

  // video 要素は画面の外で作られているので、この枠の中に移す
  useEffect(() => {
    const video = videoRef.current;
    if (!container || !video) return;
    video.controls = false;
    video.playsInline = true;
    video.muted = true;
    video.className = 'video';
    container.prepend(video);
    setPlaying(!video.paused);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.pause();
      video.remove();
    };
  }, [container, videoRef]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  };

  const goTo = (index: number) => {
    const video = videoRef.current;
    if (video) showFrame(video, result, index);
  };

  const onIndex = useCallback(
    (i: number) => {
      setFrameIndex(i);
      onFrameIndex?.(i);
    },
    [onFrameIndex],
  );
  const current = result.frames[frameIndex];

  return (
    <div className="player">
      <div
        ref={setContainer}
        className="video-box"
        style={{ aspectRatio: `${result.width} / ${result.height}` }}
      >
        <SkeletonOverlay
          videoRef={videoRef}
          frames={result.frames}
          width={result.width}
          height={result.height}
          onFrameIndex={onIndex}
        />
      </div>
      <input
        type="range"
        className="slider"
        aria-label={ja.player.slider}
        data-testid="frame-slider"
        min={0}
        max={Math.max(result.frames.length - 1, 0)}
        step={1}
        value={Math.max(frameIndex, 0)}
        onChange={(e) => goTo(Number(e.target.value))}
      />
      <div className="row">
        <button data-testid="prev-frame" onClick={() => goTo(frameIndex - 1)}>
          {ja.player.prevFrame}
        </button>
        <button data-testid="toggle-play" onClick={togglePlay}>
          {playing ? ja.player.pause : ja.player.play}
        </button>
        <button data-testid="next-frame" onClick={() => goTo(frameIndex + 1)}>
          {ja.player.nextFrame}
        </button>
      </div>
      <p className="muted small" data-testid="frame-label" data-frame-index={frameIndex}>
        {current ? ja.player.frameLabel(frameIndex, result.frames.length, current.timeSec) : ''}
        {current && !current.landmarks ? ` — ${ja.player.noPerson}` : ''}
      </p>
      <p className="muted small">{ja.player.legend}</p>
    </div>
  );
}
