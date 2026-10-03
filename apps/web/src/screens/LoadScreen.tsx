import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { isAborted, runAnalysis, type AnalysisResult } from '../analysis/runAnalysis';
import { ConfirmDialog } from '../components/Dialog';
import { ShooterDialog } from '../components/ShooterDialog';
import { poseBackendConfig } from '../config/backends';
import type { ShooterRow } from '../db/schema';
import { ja } from '../i18n/ja';
import { loadVideo, releaseVideo } from '../video/load';
import { estimateFrameRate } from '../video/seek';

const FALLBACK_FPS = 30;
/** 射手の選択肢のうち「新しい射手を登録」を表す値 */
const ADD_SHOOTER = 'add';

interface Props {
  /** video 要素の置き場所。プレイヤー（App が 1 つだけ置く）と共有する */
  videoRef: MutableRefObject<HTMLVideoElement | null>;
  shooters: ShooterRow[];
  /** 選択中の射手。まだ誰も登録されていなければ null */
  shooter: ShooterRow | null;
  onShooterChange: (shooterId: number) => void;
  onShootersChanged: () => Promise<void>;
  result: AnalysisResult | null;
  /** file は選んだ動画ファイル（保存のとき、動画本体と撮影日時の初期値に使う） */
  onResult: (r: AnalysisResult | null, file: File | null) => void;
  /** 保存していない動画があるか。あれば、動画を選び直す前に確認する */
  hasUnsaved: boolean;
  /** 推定が終わったあと、切り抜きへ進む */
  onGoClip: () => void;
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
  const { videoRef, shooters, shooter, result, hasUnsaved } = props;
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [shooterDialog, setShooterDialog] = useState<'add' | 'edit' | null>(null);
  /** 保存していないマークを捨てて動画を選び直してよいか、確認中か */
  const [confirmingPick, setConfirmingPick] = useState(false);
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
    props.onResult(null, null);
    releaseVideo(videoRef.current);
    videoRef.current = null;
    fileRef.current = file;
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
    props.onResult(null, null);
    try {
      const analyzed = await runAnalysis({
        video,
        config: poseBackendConfig(),
        fps: info.fps ?? FALLBACK_FPS,
        signal: controller.signal,
        onPreparing: () => setStatus({ kind: 'preparing' }),
        onProgress: (done, total) => setStatus({ kind: 'running', done, total }),
      });
      // 推定に使った video はここで解放する（以後の表示は、ファイルから作り直したプレイヤーが受け持つ）
      releaseVideo(video);
      videoRef.current = null;
      props.onResult(analyzed, fileRef.current);
      setStatus({
        kind: 'done',
        frames: analyzed.frames.length,
        sec: analyzed.timing.totalMs / 1000,
        notes: analyzed.notes,
      });
    } catch (e) {
      if (isAborted(e)) setStatus({ kind: 'cancelled' });
      else setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const confirmPick = () => {
    setConfirmingPick(false);
    // ファイル選択は、利用者の操作（このボタンを押したこと）の中で開く必要がある
    fileInputRef.current?.click();
  };

  const busy = status.kind === 'preparing' || status.kind === 'running';
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
      </section>
    );
  }

  return (
    <section>
      {!picked && (
        <p className="muted small" data-testid="load-format-hint">
          {ja.load.formatHint} {ja.load.formatHintIphone}
        </p>
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
            onClick={() => {
              if (hasUnsaved) setConfirmingPick(true);
              else fileInputRef.current?.click();
            }}
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
      </div>

      {status.kind === 'unsupported' && (
        <div className="notice err">
          <strong>{ja.load.unsupportedTitle}</strong>
          <p className="small">{ja.load.unsupported}</p>
        </div>
      )}
      {info && (
        <p className="muted small num">{ja.load.videoInfo(info.w, info.h, info.sec, info.fps)}</p>
      )}

      <div className="field">
        <span id="shooter-label">{ja.shooter.label}</span>
        {shooter ? (
          <div className="row nowrap tight">
            <select
              className="grow"
              data-testid="shooter-select"
              aria-labelledby="shooter-label"
              value={shooter.id}
              disabled={busy}
              onChange={(e) => {
                if (e.target.value === ADD_SHOOTER) setShooterDialog('add');
                else props.onShooterChange(Number(e.target.value));
              }}
            >
              {shooters.map((s) => (
                <option key={s.id} value={s.id}>
                  {ja.shooter.option(s.name, s.handedness)}
                </option>
              ))}
              <option value={ADD_SHOOTER}>{ja.shooter.addOption}</option>
            </select>
            <button
              data-testid="shooter-edit"
              disabled={busy}
              onClick={() => setShooterDialog('edit')}
            >
              {ja.shooter.edit}
            </button>
          </div>
        ) : (
          <>
            <button
              className="full"
              data-testid="shooter-register"
              onClick={() => setShooterDialog('add')}
            >
              {ja.shooter.registerFirst}
            </button>
            <span>{ja.shooter.requiredHint}</span>
          </>
        )}
      </div>

      {/* 完了後はやり直しのボタンを出さない。Safari は、一度画面に置いた video を外すと
          その後のシークが終わらなくなり、同じ動画のやり直しが止まってしまうため。
          やり直すときは動画を選び直す（新しい video 要素になる） */}
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
          {busy && <button onClick={() => abortRef.current?.abort()}>{ja.load.cancel}</button>}
        </div>
      )}

      {status.kind === 'preparing' && <p>{ja.load.preparing}</p>}
      {status.kind === 'running' && (
        <div>
          <progress value={status.done} max={status.total} className="progress" />
          <p>{ja.load.progress(status.done, status.total)}</p>
        </div>
      )}
      {status.kind === 'done' && (
        <div className="notice ok">
          <strong>{ja.load.doneTitle}</strong>
          <p className="small num" data-testid="analysis-done">
            {ja.load.done(status.frames, status.sec)}
            {status.notes.includes('gpuFallback') ? `（${ja.load.gpuFallback}）` : ''}
          </p>
          <div className="stack">
            <button className="primary full" data-testid="go-clip" onClick={props.onGoClip}>
              {ja.load.goClip}
            </button>
          </div>
        </div>
      )}
      {status.kind === 'cancelled' && <p>{ja.load.cancelled}</p>}
      {status.kind === 'error' && (
        <div className="notice err">
          <strong>{ja.load.errorTitle}</strong>
          <p className="small">{ja.load.error(status.message)}</p>
        </div>
      )}

      {shooterDialog && (
        <ShooterDialog
          shooters={shooters}
          {...(shooterDialog === 'edit' && shooter ? { editing: shooter } : {})}
          onCancel={() => setShooterDialog(null)}
          onDone={(id) => {
            void props.onShootersChanged().then(() => {
              props.onShooterChange(id);
              setShooterDialog(null);
            });
          }}
        />
      )}

      {confirmingPick && (
        <ConfirmDialog
          title={ja.load.discardTitle}
          confirmLabel={ja.load.discardConfirm}
          destructive
          onConfirm={confirmPick}
          onCancel={() => setConfirmingPick(false)}
          testId="discard-dialog"
        >
          <p className="small">{ja.load.discardBody}</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
