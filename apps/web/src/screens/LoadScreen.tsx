import type { Handedness } from '@pistol-kamae/engine';
import { useEffect, useRef, useState } from 'react';
import { isAborted, runAnalysis, type AnalysisResult } from '../analysis/runAnalysis';
import { VideoPlayer } from '../components/VideoPlayer';
import { BACKEND_CHOICES, backendConfigOf, type BackendChoice } from '../config/backends';
import { ja } from '../i18n/ja';
import { estimateFrameRate } from '../video/seek';

const FALLBACK_FPS = 30;
const METADATA_TIMEOUT_MS = 30_000;

interface Props {
  backend: BackendChoice;
  onBackendChange: (b: BackendChoice) => void;
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

/** video 要素を作って、メタ情報が読めるまで待つ。再生できない形式なら例外 */
async function loadVideo(file: File): Promise<HTMLVideoElement> {
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.src = URL.createObjectURL(file);
  await new Promise<void>((resolve, reject) => {
    // iOS Safari はメタ情報の読込がいつまでも終わらないことがあるため、時間切れを設ける
    const timer = setTimeout(() => reject(new Error('metadata timeout')), METADATA_TIMEOUT_MS);
    v.addEventListener(
      'loadedmetadata',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    v.addEventListener(
      'error',
      () => {
        clearTimeout(timer);
        reject(new Error('unsupported'));
      },
      { once: true },
    );
    // 一部のブラウザ（iOS Safari）は明示的に load() を呼ばないと読み始めない
    v.load();
  });
  if (v.videoWidth === 0 || v.videoHeight === 0) throw new Error('unsupported');
  return v;
}

function releaseVideo(v: HTMLVideoElement | null) {
  if (!v) return;
  v.pause();
  URL.revokeObjectURL(v.src);
  v.removeAttribute('src');
  v.load();
}

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
        config: backendConfigOf(props.backend),
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
          <span>{ja.load.backend}</span>
          <select
            value={props.backend}
            disabled={busy}
            onChange={(e) => props.onBackendChange(e.target.value as BackendChoice)}
          >
            {BACKEND_CHOICES.map((c) => (
              <option key={c} value={c}>
                {ja.backends[c]}
              </option>
            ))}
          </select>
        </label>
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
