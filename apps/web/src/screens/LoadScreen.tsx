import type { Handedness } from '@pistol-kamae/engine';
import { useEffect, useRef, useState } from 'react';
import { isAborted, runAnalysis, type AnalysisResult } from '../analysis/runAnalysis';
import { VideoPlayer } from '../components/VideoPlayer';
import { poseBackendConfig } from '../config/backends';
import { ja } from '../i18n/ja';
import { loadVideo, releaseVideo } from '../video/load';
import { estimateFrameRate } from '../video/seek';

const FALLBACK_FPS = 30;

interface Props {
  handedness: Handedness;
  onHandednessChange: (h: Handedness) => void;
  result: AnalysisResult | null;
  onResult: (r: AnalysisResult | null) => void;
}

interface VideoInfo {
  w: number;
  h: number;
  sec: number;
  fps: number | null;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'unsupported' }
  | { kind: 'preparing' }
  | { kind: 'running'; done: number; total: number }
  | { kind: 'done'; frames: number; sec: number; notes: string[] }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string };

export function LoadScreen(props: Props) {
  // video 要素は React の管理外（DOM を直接いじる）なので ref で持つ
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const abortRef = useRef<AbortController | null>(null);

  // 画面を閉じるときに動画を解放する
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      releaseVideo(videoRef.current);
    };
  }, []);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    abortRef.current?.abort();
    props.onResult(null);
    releaseVideo(videoRef.current);
    videoRef.current = null;
    setInfo(null);
    setStatus({ kind: 'loading' });
    try {
      const v = await loadVideo(file);
      videoRef.current = v;
      const fps = await estimateFrameRate(v);
      setInfo({ w: v.videoWidth, h: v.videoHeight, sec: v.duration, fps });
      setStatus({ kind: 'ready' });
    } catch {
      setStatus({ kind: 'unsupported' });
    }
  };

  const run = async () => {
    const video = videoRef.current;
    if (!video || !info) return;
    const controller = new AbortController();
    abortRef.current = controller;
    props.onResult(null);
    try {
      const result = await runAnalysis({
        video,
        config: poseBackendConfig(),
        fps: info.fps ?? FALLBACK_FPS,
        signal: controller.signal,
        onPreparing: () => setStatus({ kind: 'preparing' }),
        onProgress: (done, total) => setStatus({ kind: 'running', done, total }),
      });
      video.currentTime = 0;
      props.onResult(result);
      setStatus({
        kind: 'done',
        frames: result.frames.length,
        sec: result.timing.totalMs / 1000,
        notes: result.notes,
      });
    } catch (e) {
      if (isAborted(e)) setStatus({ kind: 'cancelled' });
      else setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const busy = status.kind === 'preparing' || status.kind === 'running';

  return (
    <section>
      <p className="muted small">{ja.load.trimHint}</p>
      <p className="muted small">
        {ja.load.formatHint} {ja.load.formatHintIphone}
      </p>

      <label className="field">
        <span>{ja.load.pickVideo}</span>
        <input
          type="file"
          accept="video/*"
          disabled={busy}
          onChange={(e) => void onPick(e.target.files?.[0])}
        />
      </label>

      {status.kind === 'loading' && <p>{ja.load.loadingVideo}</p>}
      {status.kind === 'unsupported' && <p className="danger">{ja.load.unsupported}</p>}
      {info && (
        <p className="muted small">{ja.load.videoInfo(info.w, info.h, info.sec, info.fps)}</p>
      )}

      <div className="row">
        <label className="field">
          <span>{ja.load.handedness}</span>
          <select
            value={props.handedness}
            onChange={(e) => props.onHandednessChange(e.target.value as Handedness)}
          >
            <option value="right">{ja.load.right}</option>
            <option value="left">{ja.load.left}</option>
          </select>
        </label>
      </div>

      <div className="row">
        <button className="primary" disabled={!info || busy} onClick={() => void run()}>
          {ja.load.run}
        </button>
        {busy && <button onClick={() => abortRef.current?.abort()}>{ja.load.cancel}</button>}
      </div>

      {status.kind === 'preparing' && <p>{ja.load.preparing}</p>}
      {status.kind === 'running' && (
        <div>
          <progress value={status.done} max={status.total} className="progress" />
          <p>{ja.load.progress(status.done, status.total)}</p>
        </div>
      )}
      {status.kind === 'done' && (
        <p>
          {ja.load.done(status.frames, status.sec)}
          {status.notes.includes('gpuFallback') ? `（${ja.load.gpuFallback}）` : ''}
        </p>
      )}
      {status.kind === 'cancelled' && <p>{ja.load.cancelled}</p>}
      {status.kind === 'error' && <p className="danger">{ja.load.error(status.message)}</p>}

      {props.result && <VideoPlayer videoRef={videoRef} result={props.result} />}
    </section>
  );
}
