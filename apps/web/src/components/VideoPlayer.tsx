import { useCallback, useEffect, useState, type RefObject } from 'react';
import { seekTimeForFrame } from '../analysis/frames';
import type { AnalysisResult } from '../analysis/runAnalysis';
import { ja } from '../i18n/ja';
import { SkeletonOverlay } from './SkeletonOverlay';

interface Props {
  /** 読込画面が作った video 要素。React の管理外なので ref で受け取る */
  videoRef: RefObject<HTMLVideoElement | null>;
  result: AnalysisResult;
}

/** 推定結果を重ねた動画プレイヤー。再生・一時停止・1 コマ送り */
export function VideoPlayer({ videoRef, result }: Props) {
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
      video.remove();
    };
  }, [container, videoRef]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  };

  const stepFrame = (delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    const next = Math.min(Math.max(frameIndex + delta, 0), result.frames.length - 1);
    if (result.frames[next]) video.currentTime = seekTimeForFrame(result.frames, next, result.fps);
  };

  const onFrameIndex = useCallback((i: number) => setFrameIndex(i), []);
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
          onFrameIndex={onFrameIndex}
        />
      </div>
      <div className="row">
        <button onClick={() => stepFrame(-1)}>{ja.player.prevFrame}</button>
        <button onClick={togglePlay}>{playing ? ja.player.pause : ja.player.play}</button>
        <button onClick={() => stepFrame(1)}>{ja.player.nextFrame}</button>
      </div>
      <p className="muted small">
        {current ? ja.player.frameLabel(frameIndex, result.frames.length, current.timeSec) : ''}
        {current && !current.landmarks ? ` — ${ja.player.noPerson}` : ''}
      </p>
      <p className="muted small">{ja.player.legend}</p>
    </div>
  );
}
