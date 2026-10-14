import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import {
  isAborted,
  isSeekStalled,
  runAnalysis,
  type AnalysisResult,
} from '../analysis/runAnalysis';
import { poseBackendConfig } from '../config/backends';
import type { ShooterRow } from '../db/schema';
import { ja } from '../i18n/ja';
import { isNoDuration, loadVideo, releaseVideo } from '../video/load';
import { estimateFrameRate } from '../video/seek';
import { keepScreenAwake } from '../video/wakeLock';

const FALLBACK_FPS = 30;
/** フレームレート推定で、1 回のシークの完了を待つ上限（ミリ秒）。切れたらそれまでの分で推定する */
const ESTIMATE_SEEK_TIMEOUT_MS = 5000;

interface Props {
  /** 推定に使う video 要素の置き場所（App が持つ） */
  videoRef: MutableRefObject<HTMLVideoElement | null>;
  /** 前の段階で選んだ射手。まだ誰も登録されていなければ null */
  shooter: ShooterRow | null;
  /** 射手の選択へ戻る（読み込んだ動画は残す） */
  onBackToShooter: () => void;
  result: AnalysisResult | null;
  /**
   * file は選んだ動画ファイル（保存のとき、動画本体と撮影日時の初期値に使う）。
   * 推定が終わって結果を渡すと、SaveScreen が自動で切り抜きへ進める
   */
  onResult: (r: AnalysisResult | null, file: File | null) => void;
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
  /** 長さを読み取れない動画（ブラウザで録画した WebM など） */
  | { kind: 'noDuration' }
  | { kind: 'preparing' }
  | { kind: 'running'; done: number; total: number }
  | { kind: 'cancelled' }
  /** 解析中にシークが止まった（時間切れ）。動画を選び直してもらう */
  | { kind: 'stalled' }
  | { kind: 'error'; message: string };

/** 親（保存の流れ）から呼ぶ操作 */
export interface LoadHandle {
  /** 読み込み・推定の途中なら「やめる」「中断」と同じに止めて true を返す。途中でなければ false */
  cancel(): boolean;
}

export const LoadScreen = forwardRef<LoadHandle, Props>(function LoadScreen(props, ref) {
  // video 要素は React の管理外（DOM を直接いじる）なので ref で持つ
  const { videoRef, shooter, result } = props;
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<File | null>(null);

  // 画面を閉じるときに動画を解放する
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      releaseVideo(videoRef.current);
    };
  }, [videoRef]);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    abortRef.current?.abort();
    // 読み込みとフレームレート推定の「やめる」に使う
    const controller = new AbortController();
    abortRef.current = controller;
    props.onResult(null, null);
    releaseVideo(videoRef.current);
    videoRef.current = null;
    fileRef.current = file;
    setInfo(null);
    setStatus({ kind: 'loading' });
    /** 「やめる」が押されていたら、動画を手放して動画の指定に戻る */
    const giveUp = () => {
      releaseVideo(videoRef.current);
      videoRef.current = null;
      fileRef.current = null;
      setStatus({ kind: 'idle' });
    };
    /** 別の動画を選び直すと新しい読み込みが始まるので、古い読み込みは画面に触らない */
    const current = () => abortRef.current === controller;
    try {
      const v = await loadVideo(file, controller.signal);
      if (controller.signal.aborted) {
        releaseVideo(v);
        if (current()) giveUp();
        return;
      }
      videoRef.current = v;
      const fps = await estimateFrameRate(v, {
        signal: controller.signal,
        seekTimeoutMs: ESTIMATE_SEEK_TIMEOUT_MS,
      });
      setInfo({ w: v.videoWidth, h: v.videoHeight, sec: v.duration, fps });
      setStatus({ kind: 'ready' });
    } catch (e) {
      if (!current()) return;
      if (controller.signal.aborted) giveUp();
      else if (isNoDuration(e)) setStatus({ kind: 'noDuration' });
      else setStatus({ kind: 'unsupported' });
    }
  };

  const run = async () => {
    const video = videoRef.current;
    if (!video || !info) return;
    const controller = new AbortController();
    abortRef.current = controller;
    props.onResult(null, null);
    // 解析の間は画面を消さないよう頼む（解析中は画面に触らないので、自動ロックで消えやすい）
    const stopKeepingAwake = keepScreenAwake();
    try {
      const analyzed = await runAnalysis({
        video,
        config: poseBackendConfig(),
        fps: info.fps ?? FALLBACK_FPS,
        signal: controller.signal,
        onPreparing: () => setStatus({ kind: 'preparing' }),
        onProgress: (done, total) => setStatus({ kind: 'running', done, total }),
      });
      // 最後のコマとほぼ同時に「中断」を押した場合は、切り抜きへ進めない
      if (controller.signal.aborted) {
        setStatus({ kind: 'cancelled' });
        return;
      }
      // 推定に使った video はここで解放する（以後の表示は、ファイルから作り直したプレイヤーが受け持つ）
      releaseVideo(video);
      videoRef.current = null;
      // 状態は「処理中」のままにして、切り抜きの画面に切り替わるまで進捗を出しておく
      // （2026-10-04、開発者の指示。完了の表示と「切り抜きへ進む」ボタンはなくした）
      props.onResult(analyzed, fileRef.current);
    } catch (e) {
      // 別の動画を選び直して中断されたときは、新しい読み込みの画面に触らない
      if (abortRef.current !== controller) return;
      if (isAborted(e)) setStatus({ kind: 'cancelled' });
      else if (isSeekStalled(e)) {
        // 止まった video は待っても戻らないことが多いので手放し、動画を選び直してもらう
        releaseVideo(video);
        videoRef.current = null;
        fileRef.current = null;
        setInfo(null);
        setStatus({ kind: 'stalled' });
      } else setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      stopKeepingAwake();
    }
  };

  const busy = status.kind === 'preparing' || status.kind === 'running';
  useImperativeHandle(
    ref,
    () => ({
      cancel: () => {
        if (!busy && status.kind !== 'loading') return false;
        abortRef.current?.abort();
        return true;
      },
    }),
    [busy, status.kind],
  );
  /** 動画を読み込み済みか。読み込んだあとは、選び直しの案内と「選択済み」を出す */
  const picked = info !== null;

  // 動画を選んだ直後（メタ情報とフレームレートの推定）は、「しばらくお待ちください」だけを出す
  // （2026-10-03、開発者の希望。写真アプリから選ぶと、ここで数秒かかる）
  if (status.kind === 'loading') {
    return (
      <section data-testid="load-waiting">
        <p className="waiting" role="status" aria-live="polite">
          {ja.load.pleaseWait}
        </p>
        {/* 読み込みやフレームレート推定が止まったときの逃げ道（押すと動画の指定に戻る） */}
        <div className="row">
          <button data-testid="load-waiting-cancel" onClick={() => abortRef.current?.abort()}>
            {ja.load.stopWaiting}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section>
      {shooter && (
        <div className="row tight">
          <span className="grow" data-testid="load-shooter">
            {ja.load.shooterLine(ja.shooter.option(shooter.name, shooter.handedness))}
          </span>
          <button data-testid="back-to-shooter" disabled={busy} onClick={props.onBackToShooter}>
            {ja.load.backToShooter}
          </button>
        </div>
      )}

      {/* ブラウザ本来のファイル選択欄は「ファイル未選択」の文字を消せないので、画面には出さず、
          自前のボタンから開く（2026-10-03、開発者の指摘。読み込んだあとも未選択に見えたため） */}
      <div className="field">
        <span id="video-pick-label" data-testid="video-pick-label">
          {picked ? ja.load.repickHint : ja.load.pickVideo}
        </span>
        <div className="row nowrap tight">
          <button
            data-testid="video-pick"
            aria-describedby="video-pick-label video-pick-state"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
          >
            {ja.load.pickButton}
          </button>
          <span
            id="video-pick-state"
            className={picked ? 'small' : 'muted small'}
            data-testid="video-pick-state"
          >
            {picked ? ja.load.picked : ja.load.notPicked}
          </span>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          data-testid="video-file"
          accept="video/*"
          hidden
          disabled={busy}
          onChange={(e) => {
            void onPick(e.target.files?.[0]);
            // 同じファイルを選び直しても反応するように、選択を消しておく
            e.target.value = '';
          }}
        />
        {/* 動画を選ぶ前も後も出す（要件 4 章「読込前に…の注記を読込ボタン付近に」） */}
        <p className="muted small" data-testid="load-trim-hint">
          {ja.load.trimHint}
        </p>
        {/* 読める形式の案内は、トリミングの案内の下に置く（2026-10-14、開発者の決定） */}
        {!picked && (
          <p className="muted small" data-testid="load-format-hint">
            {ja.load.formatHint} {ja.load.formatHintIphone}
          </p>
        )}
      </div>

      {status.kind === 'unsupported' && (
        <div className="notice err" data-testid="load-unsupported">
          <strong>{ja.load.unsupportedTitle}</strong>
          <p className="small">{ja.load.unsupported}</p>
        </div>
      )}
      {status.kind === 'noDuration' && (
        <div className="notice err" data-testid="load-no-duration">
          <strong>{ja.load.noDurationTitle}</strong>
          <p className="small">{ja.load.noDurationBody}</p>
        </div>
      )}
      {info && (
        <p className="muted small num">{ja.load.videoInfo(info.w, info.h, info.sec, info.fps)}</p>
      )}

      {/* 推定が終わって切り抜きへ切り替わるまでの一瞬は、実行と中断のボタンを出さない。
          Safari は、一度画面に置いた video を外すとその後のシークが終わらなくなり、同じ動画の
          やり直しが止まってしまうため、やり直すときは動画を選び直す（新しい video 要素になる） */}
      {!result && (
        <div className="row">
          <button
            className="primary full"
            data-testid="run-analysis"
            disabled={!info || !shooter || busy}
            onClick={() => void run()}
          >
            {ja.load.run}
          </button>
          {busy && (
            <button data-testid="load-cancel" onClick={() => abortRef.current?.abort()}>
              {ja.load.cancel}
            </button>
          )}
        </div>
      )}

      {status.kind === 'preparing' && <p>{ja.load.preparing}</p>}
      {status.kind === 'running' && (
        <div>
          <progress value={status.done} max={status.total} className="progress" />
          <p>{ja.load.progress(status.done, status.total)}</p>
        </div>
      )}
      {status.kind === 'cancelled' && <p>{ja.load.cancelled}</p>}
      {status.kind === 'stalled' && (
        <div className="notice err" data-testid="load-stalled">
          <strong>{ja.load.stalledTitle}</strong>
          <p className="small">{ja.load.stalledBody}</p>
        </div>
      )}
      {status.kind === 'error' && (
        <div className="notice err" data-testid="load-error">
          <strong>{ja.load.errorTitle}</strong>
          <p className="small">{ja.load.error(status.message)}</p>
        </div>
      )}
    </section>
  );
});
