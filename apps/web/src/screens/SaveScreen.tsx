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
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { frameRange, nearestFrameInRange, snapToFrame } from '../analysis/frames';
import type { AnalysisResult } from '../analysis/runAnalysis';
import { loudestTimeSec } from '../audio/envelope';
import { adoptEnvelope, useAudioEnvelope } from '../audio/useAudioEnvelope';
import { VIDEO_MAX_BYTES, VIDEO_MAX_MB } from '../video/limits';
import { ConfirmDialog } from '../components/Dialog';
import type { NavEntry } from '../navigation/history';
import { useNav, useNavListener } from '../navigation/useNav';
import { RecordForm } from '../components/RecordForm';
import { SinglePlayer } from '../components/SinglePlayer';
import { StepBar } from '../components/StepBar';
import type { BarMarker, WaveSeries } from '../components/WaveBar';
import { addRecord, setRecordVideo, type RecordFields, type RecordImages } from '../db/library';
import type { ShooterRow } from '../db/schema';
import { ja } from '../i18n/ja';
import { captureShotImages } from '../video/capture';
import { LoadScreen } from './LoadScreen';
import { ShooterStep } from './ShooterStep';
import type { LoadHandle } from './LoadScreen';

/**
 * 保存する動画本体の大きさの上限（バイト）。保存と表示のとき、動画全体を一度メモリに載せるので、
 * 大きすぎる動画はスマートフォンでブラウザが落ちる恐れがある。これを超える動画は、記録だけを保存する
 */

export type SaveStep = 'shooter' | 'video' | 'clip' | 'shot' | 'form' | 'done';
/** 段階の順（履歴の合図が「前へ」か「先へ」かを見分ける） */
const ORDER: SaveStep[] = ['shooter', 'video', 'clip', 'shot', 'form', 'done'];
/** その動画のために積んだ段階（保存が終わったら履歴から取り除く） */
const isFlowStep = (e: NavEntry) => e.view === 'save' && e.step !== 'shooter' && e.step !== 'done';

interface Props {
  /** この画面が表示中か。隠れたら再生を止める */
  active: boolean;
  /** 推定に使う video 要素の置き場所（動画の指定の段階だけ使う） */
  videoRef: RefObject<HTMLVideoElement | null>;
  shooters: ShooterRow[];
  /** 射手の一覧を読み終えたか */
  shootersReady: boolean;
  shooter: ShooterRow | null;
  onShooterChange: (shooterId: number) => void;
  onShootersChanged: () => Promise<void>;
  /** 保存していない動画があるかどうかが変わったとき（タブの印に使う） */
  onUnsavedChange: (unsaved: boolean) => void;
  /** 段階が変わったとき（App がタブの切り替えで履歴に積む項目に書く） */
  onStepChange: (step: SaveStep) => void;
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
 * 「動画の保存」：射手の選択 → 動画の指定 → 切り抜き → 撃発ポイントの特定 → 保存（タイトル・メモ）。
 * 射手の選択は ShooterStep、動画の指定（推定が終わるまで）は読込画面（LoadScreen）が受け持ち、その後は 1 本のプレイヤーで切り抜きと撃発ポイントを決める。
 */
export function SaveScreen(props: Props) {
  const { active, videoRef, shooters, shooter, onUnsavedChange } = props;
  const [step, setStep] = useState<SaveStep>('shooter');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [file, setFile] = useState<File | null>(null);
  /** プレイヤーに渡す、ファイルの一時的な URL（どのファイルの URL かを一緒に持つ） */
  const [urlEntry, setUrlEntry] = useState<{ file: File; url: string } | null>(null);
  const [clip, setClip] = useState<Clip>({ startSec: 0, endSec: 0 });
  const [valueSec, setValueSec] = useState(0);
  const [shotSec, setShotSec] = useState<number | null>(null);
  const [images, setImages] = useState<RecordImages | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [captureFailed, setCaptureFailed] = useState(false);
  /** 撃発の段階のプレイヤーが再生中か。再生中は撃発ポイントを確定できない（コマが動いている間に撮らない） */
  const [playing, setPlaying] = useState(false);
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
  /** 保存の書き込み中（「戻る」を受け付けない） */
  const [saving, setSaving] = useState(false);
  const nav = useNav();
  const loadRef = useRef<LoadHandle>(null);
  /** 今の段階（撮影のあとなど、時間のかかる処理の終わりに最新の段階で判断するため） */
  const stepRef = useRef(step);
  useLayoutEffect(() => {
    stepRef.current = step;
  }, [step]);
  /** 「保存せずに進む」を押したあと（履歴を戻した先で、確認なしに捨てる） */
  const discardRef = useRef(false);
  const { onStepChange } = props;
  useEffect(() => onStepChange(step), [step, onStepChange]);
  /**
   * 別のタブを見ている間に段階が進んだ（推定が終わって切り抜きへ、など）ので、履歴にまだ積んでいない印。
   * 積むと画面がこのタブへ切り替わってしまうため、積まずに段階だけ進め、戻ってきたときに履歴を合わせる
   */
  const pendingPushRef = useRef(false);
  /** このタブが表示中か（推定の完了は、始めたときの古い関数から知らされるので、最新の値を ref で見る） */
  const activeRef = useRef(active);
  useLayoutEffect(() => {
    activeRef.current = active;
  }, [active]);
  /** 段階を 1 つ進め、履歴に積む（このタブが表示中のときだけ） */
  const advance = useCallback(
    (to: SaveStep) => {
      setStep(to);
      if (activeRef.current) {
        pendingPushRef.current = false;
        nav.push({ view: 'save', step: to });
      } else pendingPushRef.current = true;
    },
    [nav],
  );
  /**
   * 1 つ前の段階へ戻る。履歴の 1 つ前がその段階なら履歴を 1 つ戻し、その合図で段階を戻す（ブラウザの「戻る」と
   * 同じ道）。そうでなければ（タブを往復したあとなど、1 つ前が別のタブ）、先頭を置き換えて自分で段階を戻す
   */
  const goBack = useCallback(
    (to: SaveStep, apply: () => void, beforeBack?: () => void) => {
      const prev = nav.previous();
      if (prev?.view === 'save' && prev.step === to) {
        beforeBack?.();
        nav.back({ view: 'save', step: to });
      } else {
        nav.replace({ view: 'save', step: to });
        apply();
      }
    },
    [nav],
  );

  const envelope = useAudioEnvelope(file ? { kind: 'file', file } : null);
  const loudest = useMemo(
    () =>
      envelope.state === 'ready'
        ? loudestTimeSec(envelope.envelope, clip.startSec, clip.endSec)
        : null,
    [envelope, clip],
  );

  // 「保存していない動画」として確認を出すのは、切り抜きに進んでから（推定が終わると自動で進む）
  const unsaved = result !== null && saved === null && step !== 'shooter' && step !== 'video';
  useEffect(() => onUnsavedChange(unsaved), [unsaved, onUnsavedChange]);
  const { onResultChange, newRequest } = props;
  useEffect(() => onResultChange(result), [result, onResultChange]);
  // 「次の動画を保存する」は射手の選択から、切り抜きの「戻る」は 1 つ前の動画の指定から、やり直す
  const reset = useCallback((to: 'shooter' | 'video') => {
    setResult(null);
    setFile(null);
    setShotSec(null);
    setImages(null);
    setSaved(null);
    setClipProblem(null);
    setCaptureFailed(false);
    setTouched(false);
    setStep(to);
  }, []);
  // ライブラリの「動画を読み込む」などで来たとき、保存し終えた状態なら新しい動画の受け入れに戻す
  // （描画の途中で状態を直す、React の「前回の props を覚える」書き方）
  const [seenRequest, setSeenRequest] = useState(newRequest);
  if (newRequest !== seenRequest) {
    setSeenRequest(newRequest);
    if (step === 'done') reset('shooter');
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
  const onResult = useCallback(
    (r: AnalysisResult | null, f: File | null) => {
      setResult(r);
      setFile(f);
      setShotSec(null);
      setImages(null);
      setSaved(null);
      setClipProblem(null);
      setCaptureFailed(false);
      setTouched(false);
      if (r) {
        setClip({ startSec: 0, endSec: r.durationSec });
        setValueSec(0);
        // 推定が終わったら、自動で切り抜きへ進む（2026-10-04、開発者の指示）
        advance('clip');
      }
    },
    [advance],
  );

  // ブラウザの「戻る」（履歴の合図）：画面の「戻る」ボタンと同じ動きにする。
  // 推定の実行中は「中断」、撮っている間と保存の書き込み中は受け付けない（項目を積み直す）
  useNavListener((entry, source) => {
    if (entry.view !== 'save') return;
    const cur = step;
    const target = entry.step;
    if (source === 'push') {
      // タブの切り替えで今の段階が積まれた：積み残しは解消
      if (target === cur) pendingPushRef.current = false;
      return;
    }
    if (pendingPushRef.current) {
      // 別のタブを見ている間に進んだ段階をまだ積んでいない：戻ってきた先頭を今の段階に置き換えて、そのまま出す
      pendingPushRef.current = false;
      nav.replace({ view: 'save', step: cur });
      return;
    }
    if (target === cur) return;
    const stay = () => nav.push({ view: 'save', step: cur });
    // 「進む」の作り込みはしない：先の段階の項目へ進んだら、履歴を 1 つ戻して今の段階に留まる
    if (ORDER.indexOf(target) > ORDER.indexOf(cur)) {
      nav.back({ view: 'save', step: cur });
      return;
    }
    /** 戻った結果の段階（null＝留まる）。着地した項目と違えば、先頭をその段階に置き換えて合わせる */
    let next: SaveStep | null = null;
    switch (cur) {
      case 'video':
        // 解析中（読み込み・推定）なら中断して、動画の指定に留まる
        if (loadRef.current?.cancel()) stay();
        else {
          setStep('shooter');
          next = 'shooter';
        }
        break;
      case 'clip':
        if (discardRef.current) {
          discardRef.current = false;
          next = target === 'shooter' ? 'shooter' : 'video';
          reset(next);
        } else {
          // 解析結果を捨ててよいか確かめる（確認の間は項目を積み直しておく）
          stay();
          setConfirmingReset(true);
        }
        break;
      case 'shot':
        if (capturing) stay();
        else {
          setStep('clip');
          next = 'clip';
        }
        break;
      case 'form':
        if (saving) stay();
        else {
          setStep('shot');
          next = 'shot';
        }
        break;
      case 'done':
        // 保存が終わった状態から戻るのは「次の動画を保存する」と同じ
        reset('shooter');
        next = 'shooter';
        break;
      case 'shooter':
        break;
    }
    if (next !== null && next !== target) nav.replace({ view: 'save', step: next });
  });

  // 撃発の段階で、まだつまみを動かしていなければ、音の最大（分かり次第）を表示する
  const shownSec =
    step === 'shot' && !touched && shotSec === null && loudest !== null ? loudest : valueSec;

  if (!result || !playerUrl || step === 'shooter' || step === 'video') {
    const openStep = step === 'shooter' ? 'shooter' : 'video';
    return (
      <section data-testid="save-screen" data-step={openStep}>
        <StepBar step={openStep} />
        {openStep === 'shooter' && (
          <ShooterStep
            shooters={shooters}
            ready={props.shootersReady}
            shooter={shooter}
            onShooterChange={props.onShooterChange}
            onShootersChanged={props.onShootersChanged}
            onNext={() => advance('video')}
          />
        )}
        {/* 動画の指定は隠すだけにして、射手の選択へ戻っても読み込んだ動画を保つ */}
        <div hidden={openStep !== 'video'}>
          <LoadScreen
            ref={loadRef}
            videoRef={videoRef}
            shooter={shooter}
            onBackToShooter={() => goBack('shooter', () => setStep('shooter'))}
            result={result}
            onResult={onResult}
          />
        </div>
      </section>
    );
  }

  const { frames, fps, durationSec } = result;
  // 表示中のコマ。切り抜きの段階は動画の全体から、撃発の段階は範囲の中から選ぶ（プレイヤーと同じ決め方）
  const barStart = step === 'shot' ? clip.startSec : 0;
  const barEnd = step === 'shot' ? clip.endSec : durationSec;
  const index = nearestFrameInRange(frames, shownSec, barStart, barEnd);
  const frameSec = frames[index]?.timeSec ?? shownSec;
  const snap = (sec: number) => snapToFrame(frames, sec);
  /** 範囲の端はコマの時刻に吸着させ、動画の中に収め、1 コマ以上の長さを保つ */
  const setClipSnapped = (startSec: number, endSec: number) => {
    const s0 = Math.max(snap(startSec), 0);
    const e0 = Math.min(snap(endSec), durationSec);
    setClip(e0 - s0 >= 1 / fps ? { startSec: s0, endSec: e0 } : clip);
  };
  const shotInClip = clipContains(clip, durationSec, frameSec);
  const waves: WaveSeries[] | undefined =
    envelope.state === 'ready'
      ? [{ key: 'audio', envelope: envelope.envelope, className: 'wave-single' }]
      : undefined;
  // コマ番号と総数は、バーの範囲（撃発の段階では切り抜きの範囲）の先頭を 1 コマ目として数える（要件 5 章 3）
  const barFrames = frameRange(frames, barStart, barEnd);
  const timeLabel = ja.player.timeLabel(
    frameSec,
    index - barFrames.first,
    barFrames.last - barFrames.first + 1,
  );
  /** 撃発ポイントのコマ番号（切り抜きの範囲の先頭から数える。撃発の段階と保存の段階で出す） */
  const shotFrameInClip = (sec: number) =>
    Math.max(frameIndexAt(frames, sec), 0) - frameRange(frames, clip.startSec, clip.endSec).first;
  const fileDate = Number.isFinite(file?.lastModified) ? new Date(file!.lastModified) : null;

  const confirmClip = () => {
    const problem = checkClip(clip, durationSec, shotSec ?? undefined);
    if (problem) {
      setClipProblem(problem);
      return;
    }
    setClipProblem(null);
    // 確定済みの撃発ポイントがあれば、つまみをそこへ置く（そのまま確定しても撃発ポイントが変わらないように）
    if (shotSec !== null) {
      setValueSec(shotSec);
      setTouched(true);
    } else {
      if (!clipContains(clip, durationSec, valueSec)) setValueSec(clip.startSec);
      setTouched(false);
    }
    advance('shot');
  };
  const setShotHere = async () => {
    const video = playerVideoRef.current;
    // 再生中は撮らない。playing（画面の状態）は再生の開始から少し遅れて立つので、video 自体も見る
    if (!video || capturing || playing || !video.paused || !shotInClip) return;
    // 確定済みの撃発ポイントと同じコマなら、撮り直さずに保存へ進む（保存の段階から戻ってきたとき）
    if (shotSec !== null && images && frameSec === shotSec) {
      advance('form');
      return;
    }
    // つまみをこのコマに固定してから撮る。音の最大に置かれたまま触らずに確定した場合に、撮っている間に
    // 音のグラフの計算が終わってつまみが音の最大へ移ったり、保存の段階から戻ったときに切り抜きのときの
    // 位置へ飛んだりしないように
    setValueSec(frameSec);
    setTouched(true);
    setCapturing(true);
    setCaptureFailed(false);
    try {
      const sec = frameSec;
      // 撃発の瞬間の静止画（詳細の写真と一覧の小さい写真）は、この場で撮っておく
      const captured = await captureShotImages(video, result, sec);
      setShotSec(sec);
      setImages(captured);
      // 確定したら、自動で保存の段階へ進む（2026-10-04、開発者の指示）。撮っている間に撃発の段階を離れていたら進めない
      if (stepRef.current === 'shot') advance('form');
    } catch {
      // 撮れなければ撃発ポイントは付けず、もう一度押してもらう（保存の段階ではプレイヤーがなく撮り直せない）
      setCaptureFailed(true);
    }
    setCapturing(false);
  };

  const saveNew = async (fields: RecordFields) => {
    if (shotSec === null || !file || !images) throw new Error('nothing to save');
    setSaving(true);
    try {
      await writeNew(fields);
    } finally {
      setSaving(false);
    }
  };
  const writeNew = async (fields: RecordFields) => {
    if (shotSec === null || !file || !images) throw new Error('nothing to save');
    const recordId = await addRecord(
      fields,
      analysisOf(result),
      setShotMark([], shotSec),
      clipOrNull(clip, durationSec),
      images,
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
    // 音のグラフは、動画本体を保存しなかった記録（上限超え・空き不足）にも写す（ファイルから計算済み。
    // 動画本体がないと、あとから計算する手段がないため）。写せなくても記録は残す
    await adoptEnvelope(file, recordId).catch(() => {});
    setSaved({ recordId, videoFailed, tooLarge });
    props.onSaved(recordId);
    setStep('done');
    // この動画のために積んだ段階（動画の指定〜保存）を履歴から取り除き、完了を 1 つ置く。
    // 戻ると「次の動画を保存する」と同じ（射手の選択）になる
    nav.unwindAndPush(isFlowStep, { view: 'save', step: 'done' });
  };
  /** 「次の動画を保存する」：完了の項目を戻す（戻る先が射手の選択でなければ、置き換える） */
  const nextVideo = () => goBack('shooter', () => reset('shooter'));

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
              onChange: setClipSnapped,
              snap,
            }}
            timeLabel={timeLabel}
            onVideo={onVideo}
            active={props.active}
            testId="clip-player"
          >
            <div className="row nowrap">
              <button
                data-testid="clip-set-start"
                onClick={() => setClipSnapped(frameSec, Math.max(clip.endSec, frameSec + 1 / fps))}
              >
                {ja.clip.setStart}
              </button>
              <button
                data-testid="clip-set-end"
                onClick={() =>
                  setClipSnapped(Math.min(clip.startSec, frameSec - 1 / fps), frameSec)
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
              {clipProblem === 'shotOutsideClip' ? ja.clip.shotOutside : ja.clip.invalid}
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
            pointer="arrow"
            timeLabel={timeLabel}
            onVideo={onVideo}
            onPlayingChange={setPlaying}
            active={props.active}
            // 撮っている間は動画を動かされたくないので、バーと ◀ ▶・再生を止める
            disabled={capturing}
            testId="shot-player"
          />
          <button
            className="primary full"
            data-testid="shot-set"
            disabled={capturing || playing || !shotInClip}
            onClick={() => void setShotHere()}
          >
            {capturing ? ja.shot.capturing : ja.shot.set}
          </button>
          {playing && (
            <p className="muted small" data-testid="shot-stop-note">
              {ja.shot.stopToSet}
            </p>
          )}
          {captureFailed && (
            <p className="danger small" data-testid="shot-capture-failed">
              {ja.shot.captureFailed}
            </p>
          )}
          {/* 保存の段階から戻ってきたときだけ、前に確定した撃発ポイントを出す */}
          {shotSec !== null && (
            <p className="small num" data-testid="shot-status">
              {ja.shot.setAt(shotSec, shotFrameInClip(shotSec))}
            </p>
          )}
          <div className="row">
            <button
              data-testid="shot-back"
              disabled={capturing}
              onClick={() => goBack('clip', () => setStep('clip'))}
            >
              {ja.shot.backToClip}
            </button>
          </div>
        </>
      )}

      {step === 'form' && shotSec !== null && (
        <>
          <div className="notice" data-testid="form-summary">
            <strong>{ja.shot.setAt(shotSec, shotFrameInClip(shotSec))}</strong>
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
            <button
              data-testid="form-back"
              disabled={saving}
              onClick={() => goBack('shot', () => setStep('shot'))}
            >
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
              {ja.save.videoTooLarge(VIDEO_MAX_MB)}
            </p>
          )}
          {saved.videoFailed && (
            <p className="small" data-testid="save-video-failed">
              {ja.save.videoFailed}
            </p>
          )}
          <div className="stack">
            <button className="primary full" data-testid="save-next" onClick={nextVideo}>
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
            // 履歴を 1 つ戻し、その合図で捨てる（ブラウザの「戻る」と同じ道）。1 つ前が動画の指定でなければ、その場で捨てる
            goBack(
              'video',
              () => reset('video'),
              () => {
                discardRef.current = true;
              },
            );
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
