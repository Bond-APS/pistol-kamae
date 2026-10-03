import {
  checkClip,
  clipContains,
  defaultTitle,
  frameIndexAt,
  setShotMark,
  toLocalDateTime,
  type Clip,
  type RecordAnalysis,
} from '@pistol-kamae/engine';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { nearestFrameIndex } from '../analysis/frames';
import type { AnalysisResult } from '../analysis/runAnalysis';
import { loudestTimeSec } from '../audio/envelope';
import { useAudioEnvelope } from '../audio/useAudioEnvelope';
import { ConfirmDialog } from '../components/Dialog';
import { RecordForm } from '../components/RecordForm';
import { SinglePlayer } from '../components/SinglePlayer';
import { StepBar } from '../components/StepBar';
import type { BarMarker, WaveSeries } from '../components/WaveBar';
import { addRecord, setRecordVideo, type RecordFields, type RecordImages } from '../db/library';
import type { ShooterRow } from '../db/schema';
import { ja } from '../i18n/ja';
import { captureShotImages } from '../video/capture';
import { LoadScreen } from './LoadScreen';

/**
 * 保存する動画本体の大きさの上限（バイト）。保存と表示のとき、動画全体を一度メモリに載せるので、
 * 大きすぎる動画はスマートフォンでブラウザが落ちる恐れがある。これを超える動画は、記録だけを保存する
 */
const VIDEO_MAX_BYTES = 200 * 1024 * 1024;

export type SaveStep = 'open' | 'clip' | 'shot' | 'form' | 'done';

interface Props {
  /** 推定に使う video 要素の置き場所（開く段階だけ使う） */
  videoRef: RefObject<HTMLVideoElement | null>;
  shooters: ShooterRow[];
  shooter: ShooterRow | null;
  onShooterChange: (shooterId: number) => void;
  onShootersChanged: () => Promise<void>;
  /** 保存していない動画があるかどうかが変わったとき（タブの印に使う） */
  onUnsavedChange: (unsaved: boolean) => void;
  /** 推定の結果が変わったとき（開発用のノイズ測定に渡す） */
  onResultChange: (result: AnalysisResult | null) => void;
  /** ライブラリの「動画を読み込む」などで来たときに増える番号。保存し終えた状態なら、新しい動画の受け入れに戻す */
  newRequest: number;
  onGoLibrary: () => void;
  /** 保存したとき（ライブラリの一覧を読み直してもらう） */
  onSaved: (recordId: number) => void;
}

const analysisOf = (r: AnalysisResult): RecordAnalysis => ({
  backendId: r.backendId,
  width: r.width,
  height: r.height,
  fps: r.fps,
  durationSec: r.durationSec,
  frames: r.frames,
});

/** 範囲が動画の全体なら「範囲なし（null）」として保存する */
const clipOrNull = (clip: Clip, durationSec: number): Clip | null =>
  clip.startSec <= 0 && clip.endSec >= durationSec ? null : clip;

/**
 * 「動画の保存」：開く → 切り抜く → 撃発ポイント → タイトル・メモ → 保存。
 * 推定が終わるまでは読込画面（LoadScreen）が受け持ち、その後は 1 本のプレイヤーで切り抜きと撃発ポイントを決める。
 */
export function SaveScreen(props: Props) {
  const { videoRef, shooters, shooter, onUnsavedChange } = props;
  const [step, setStep] = useState<SaveStep>('open');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [file, setFile] = useState<File | null>(null);
  /** プレイヤーに渡す、ファイルの一時的な URL（どのファイルの URL かを一緒に持つ） */
  const [urlEntry, setUrlEntry] = useState<{ file: File; url: string } | null>(null);
  const [clip, setClip] = useState<Clip>({ startSec: 0, endSec: 0 });
  const [valueSec, setValueSec] = useState(0);
  const [shotSec, setShotSec] = useState<number | null>(null);
  const [images, setImages] = useState<RecordImages | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [clipProblem, setClipProblem] = useState<'shotOutsideClip' | 'invalidClip' | null>(null);
  const [saved, setSaved] = useState<{
    recordId: number;
    videoFailed: boolean;
    tooLarge: boolean;
  } | null>(null);
  /** 撃発の段階で、利用者がつまみを動かしたか（動かす前なら、音の最大が分かった時点でそこへ置く） */
  const [touched, setTouched] = useState(false);
  const playerVideoRef = useRef<HTMLVideoElement | null>(null);
  const onVideo = useCallback((v: HTMLVideoElement | null) => {
    playerVideoRef.current = v;
  }, []);
  const [confirmingReset, setConfirmingReset] = useState(false);

  const envelope = useAudioEnvelope(file ? { kind: 'file', file } : null);
  const loudest = useMemo(
    () =>
      envelope.state === 'ready'
        ? loudestTimeSec(envelope.envelope, clip.startSec, clip.endSec)
        : null,
    [envelope, clip],
  );

  const unsaved = result !== null && saved === null;
  useEffect(() => onUnsavedChange(unsaved), [unsaved, onUnsavedChange]);
  const { onResultChange, newRequest } = props;
  useEffect(() => onResultChange(result), [result, onResultChange]);
  const reset = useCallback(() => {
    setResult(null);
    setFile(null);
    setShotSec(null);
    setImages(null);
    setSaved(null);
    setClipProblem(null);
    setTouched(false);
    setStep('open');
  }, []);
  // ライブラリの「動画を読み込む」などで来たとき、保存し終えた状態なら新しい動画の受け入れに戻す
  // （描画の途中で状態を直す、React の「前回の props を覚える」書き方）
  const [seenRequest, setSeenRequest] = useState(newRequest);
  if (newRequest !== seenRequest) {
    setSeenRequest(newRequest);
    if (step === 'done') reset();
  }

  // ファイルの URL は、推定が終わってから作り、動画を替える・保存し終えて次へ進むときに解放する
  useEffect(() => {
    if (!file || !result) return;
    const url = URL.createObjectURL(file);
    let alive = true;
    void Promise.resolve().then(() => {
      if (alive) setUrlEntry({ file, url });
    });
    return () => {
      alive = false;
      URL.revokeObjectURL(url);
    };
  }, [file, result]);
  // ファイルが替わった直後は、前のファイルの（解放済みの）URL を渡さない
  const playerUrl = urlEntry && urlEntry.file === file ? urlEntry.url : null;
  const onResult = useCallback((r: AnalysisResult | null, f: File | null) => {
    setResult(r);
    setFile(f);
    setShotSec(null);
    setImages(null);
    setSaved(null);
    setClipProblem(null);
    setTouched(false);
    if (r) {
      setClip({ startSec: 0, endSec: r.durationSec });
      setValueSec(0);
    }
  }, []);

  // 撃発の段階で、まだつまみを動かしていなければ、音の最大（分かり次第）を表示する
  const shownSec =
    step === 'shot' && !touched && shotSec === null && loudest !== null ? loudest : valueSec;

  if (!result || !playerUrl || step === 'open') {
    return (
      <section data-testid="save-screen" data-step="open">
        <StepBar step="open" />
        <LoadScreen
          videoRef={videoRef}
          shooters={shooters}
          shooter={shooter}
          onShooterChange={props.onShooterChange}
          onShootersChanged={props.onShootersChanged}
          result={result}
          onResult={onResult}
          hasUnsaved={unsaved}
          onGoClip={() => {
            setValueSec(clip.startSec);
            setStep('clip');
          }}
        />
      </section>
    );
  }

  const { frames, fps, durationSec } = result;
  const index = nearestFrameIndex(frames, shownSec);
  const frameSec = frames[index]?.timeSec ?? shownSec;
  const waves: WaveSeries[] | undefined =
    envelope.state === 'ready'
      ? [{ key: 'audio', envelope: envelope.envelope, className: 'wave-single' }]
      : undefined;
  const timeLabel = ja.player.timeLabel(frameSec, index, frames.length);
  const fileDate = Number.isFinite(file?.lastModified) ? new Date(file!.lastModified) : null;

  const confirmClip = () => {
    const problem = checkClip(clip, durationSec, shotSec ?? undefined);
    if (problem) {
      setClipProblem(problem);
      return;
    }
    setClipProblem(null);
    if (!clipContains(clip, durationSec, valueSec)) setValueSec(clip.startSec);
    setTouched(false);
    setStep('shot');
  };
  const setShotHere = async () => {
    const video = playerVideoRef.current;
    if (!video || capturing) return;
    setCapturing(true);
    try {
      const sec = frameSec;
      // 撃発の瞬間の静止画（詳細の写真と一覧の小さい写真）は、この場で撮っておく
      const captured = await captureShotImages(video, result, sec);
      setShotSec(sec);
      setImages(captured);
    } catch {
      // 撮れなくても撃発ポイントは付ける（静止画は保存のときにもう一度試す）
      setShotSec(frameSec);
      setImages(null);
    }
    setCapturing(false);
  };

  const saveNew = async (fields: RecordFields) => {
    if (shotSec === null || !file) throw new Error('nothing to save');
    const video = playerVideoRef.current;
    const captured = images ?? (video ? await captureShotImages(video, result, shotSec) : null);
    if (!captured) throw new Error('no images');
    const recordId = await addRecord(
      fields,
      analysisOf(result),
      setShotMark([], shotSec),
      clipOrNull(clip, durationSec),
      captured,
    );
    // 動画本体は大きいので、記録とは別に保存する。失敗しても記録は残し、その旨を知らせる
    const tooLarge = file.size > VIDEO_MAX_BYTES;
    let videoFailed = false;
    if (!tooLarge) {
      try {
        await setRecordVideo(recordId, { bytes: await file.arrayBuffer(), type: file.type });
      } catch {
        videoFailed = true;
      }
    }
    setSaved({ recordId, videoFailed, tooLarge });
    props.onSaved(recordId);
    setStep('done');
  };

  const shotMarkers: BarMarker[] = [];
  if (shotSec !== null) shotMarkers.push({ key: 'shot', sec: shotSec, label: ja.shot.marker });
  else if (step === 'shot' && loudest !== null) {
    shotMarkers.push({ key: 'loudest', sec: loudest, label: ja.shot.loudest });
  }

  return (
    <section data-testid="save-screen" data-step={step}>
      <StepBar step={step} />

      {step === 'clip' && (
        <>
          <p className="muted small">{ja.clip.intro}</p>
          <SinglePlayer
            videoUrl={playerUrl}
            analysis={result}
            startSec={0}
            endSec={durationSec}
            valueSec={valueSec}
            onChange={setValueSec}
            {...(waves ? { waves } : {})}
            noAudio={envelope.state === 'none'}
            markers={shotMarkers}
            handles={{
              startSec: clip.startSec,
              endSec: clip.endSec,
              onChange: (startSec, endSec) => setClip({ startSec, endSec }),
            }}
            timeLabel={timeLabel}
            onVideo={onVideo}
            testId="clip-player"
          >
            <div className="row nowrap">
              <button
                data-testid="clip-set-start"
                onClick={() =>
                  setClip({ startSec: frameSec, endSec: Math.max(clip.endSec, frameSec + 1 / fps) })
                }
              >
                {ja.clip.setStart}
              </button>
              <button
                data-testid="clip-set-end"
                onClick={() =>
                  setClip({
                    startSec: Math.min(clip.startSec, frameSec - 1 / fps),
                    endSec: frameSec,
                  })
                }
              >
                {ja.clip.setEnd}
              </button>
            </div>
          </SinglePlayer>
          <p className="muted small num" data-testid="clip-length">
            {ja.clip.length(clip.endSec - clip.startSec, durationSec)}
          </p>
          <p className="muted small">{ja.clip.keepNote}</p>
          {clipProblem && (
            <p className="danger small" data-testid="clip-problem">
              {clipProblem === 'shotOutsideClip' ? ja.clip.shotOutside : ja.clip.tooShort}
            </p>
          )}
          <button className="primary full" data-testid="clip-confirm" onClick={confirmClip}>
            {ja.clip.confirm}
          </button>
          <div className="row">
            <button data-testid="save-reset" onClick={() => setConfirmingReset(true)}>
              {ja.common.back}
            </button>
          </div>
        </>
      )}

      {step === 'shot' && (
        <>
          <p className="muted small">
            {envelope.state === 'none' ? ja.shot.introNoAudio : ja.shot.intro}
          </p>
          <SinglePlayer
            videoUrl={playerUrl}
            analysis={result}
            startSec={clip.startSec}
            endSec={clip.endSec}
            valueSec={shownSec}
            onChange={(sec) => {
              setTouched(true);
              setValueSec(sec);
            }}
            {...(waves ? { waves } : {})}
            noAudio={envelope.state === 'none'}
            markers={shotMarkers}
            timeLabel={timeLabel}
            onVideo={onVideo}
            testId="shot-player"
          />
          <button
            className={shotSec === null ? 'primary full' : 'full'}
            data-testid="shot-set"
            disabled={capturing}
            onClick={() => void setShotHere()}
          >
            {capturing ? ja.shot.capturing : shotSec === null ? ja.shot.set : ja.shot.reset}
          </button>
          <p className="small num" data-testid="shot-status">
            {shotSec === null
              ? ja.shot.notSet
              : ja.shot.setAt(shotSec, Math.max(frameIndexAt(frames, shotSec), 0))}
          </p>
          <button
            className={shotSec === null ? 'full' : 'primary full'}
            data-testid="shot-to-save"
            disabled={shotSec === null}
            onClick={() => setStep('form')}
          >
            {shotSec === null ? ja.shot.toSaveDisabled : ja.shot.toSave}
          </button>
          <div className="row">
            <button data-testid="shot-back" onClick={() => setStep('clip')}>
              {ja.shot.backToClip}
            </button>
          </div>
        </>
      )}

      {step === 'form' && shotSec !== null && (
        <>
          <div className="notice" data-testid="form-summary">
            <strong>{ja.shot.setAt(shotSec, Math.max(frameIndexAt(frames, shotSec), 0))}</strong>
            <p className="small num">{ja.save.summaryClip(clip.startSec, clip.endSec)}</p>
          </div>
          {shooter && (
            <RecordForm
              mode="save"
              shooters={shooters}
              initial={{
                title: defaultTitle(toLocalDateTime(fileDate ?? new Date())),
                shooterId: shooter.id,
                shotAt: toLocalDateTime(fileDate ?? new Date()),
                memo: '',
                favorite: false,
              }}
              onSubmit={saveNew}
              onShootersChanged={props.onShootersChanged}
            />
          )}
          <div className="row">
            <button data-testid="form-back" onClick={() => setStep('shot')}>
              {ja.common.back}
            </button>
          </div>
        </>
      )}

      {step === 'done' && saved && (
        <div className="notice ok" data-testid="save-done" data-saved-id={saved.recordId}>
          <strong>{ja.save.savedTitle}</strong>
          {saved.tooLarge && (
            <p className="small" data-testid="save-video-too-large">
              {ja.save.videoTooLarge}
            </p>
          )}
          {saved.videoFailed && (
            <p className="small" data-testid="save-video-failed">
              {ja.save.videoFailed}
            </p>
          )}
          <div className="stack">
            <button className="primary full" data-testid="save-next" onClick={reset}>
              {ja.save.nextVideo}
            </button>
            <button className="full" data-testid="save-view" onClick={props.onGoLibrary}>
              {ja.save.viewLibrary}
            </button>
          </div>
        </div>
      )}

      {confirmingReset && (
        <ConfirmDialog
          title={ja.load.discardTitle}
          confirmLabel={ja.load.discardConfirm}
          destructive
          onConfirm={() => {
            setConfirmingReset(false);
            reset();
          }}
          onCancel={() => setConfirmingReset(false)}
          testId="discard-dialog"
        >
          <p className="small">{ja.load.discardBody}</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
