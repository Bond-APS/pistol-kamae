import {
  IDENTITY,
  checkClip,
  type ClipProblem,
  clipOf,
  commonWindow,
  compareMetrics,
  frameIndexAt,
  metricsAtFrame,
  setShotMark,
  shotMarkOf,
  shotWindow,
  tiltDegOfRecord,
  type LandmarkFrame,
} from '@pistol-kamae/engine';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  frameRange,
  nearestFrameIndex,
  seekTimeForFrame,
  snapClipEdges,
  snapToFrame,
} from '../analysis/frames';
import { useAudioEnvelope } from '../audio/useAudioEnvelope';
import {
  canNormalize,
  overlayLayout,
  sameAspect,
  sequenceBounds,
  sideBySideViews,
  type AlignMode,
  type PoseSide,
} from '../compare/layout';
import { AttachVideo } from '../components/AttachVideo';
import { CompareStage, type StageLayer } from '../components/CompareStage';
import { DiffTable } from '../components/DiffTable';
import { ExportStatusLine } from '../components/ExportStatusLine';
import { NumbersFold } from '../components/NumbersFold';
import { skeletonParts } from '../components/skeleton';
import { SkeletonLayer } from '../components/SkeletonLayer';
import { TransportControls } from '../components/TransportControls';
import { useRecordVideoUrl } from '../components/useRecordVideoUrl';
import { WaveBar, type WaveSeries } from '../components/WaveBar';
import { SHOT_EDIT_SPAN_SEC, peakShot, shiftShot, shotFrameDelta } from '../compare/shotEdit';
import { overwriteRecordMarksAll, updateRecordClipAll, type OpenedRecord } from '../db/library';
import { compareFileName } from '../export/filename';
import {
  canvasToPng,
  drawOverlay,
  imageFromBytes,
  type LoadedImage,
  type PngLayer,
  type PngSkeleton,
  waitVideoSettled,
} from '../export/png';
import { useExport } from '../export/useExport';
import { ja } from '../i18n/ja';
import { useNav, useNavListener } from '../navigation/useNav';
import { captureShotImages } from '../video/capture';
import { usePlayback, type PlaybackVideo } from '../video/usePlayback';

interface Props {
  base: OpenedRecord;
  current: OpenedRecord;
  /** 動画を付け直したとき */
  onVideoAttached: (role: Role) => void;
  /** 撃発ポイントや切り抜きの範囲を書き換えたとき（読み直してもらう） */
  onRecordsChanged: (recordIds: number[]) => void;
}

export type Role = 'base' | 'current';
const ROLES: readonly Role[] = ['base', 'current'];
const roleName = (role: Role): string => (role === 'base' ? ja.compare.base : ja.compare.current);

/** 人物の大きさがこの割合を超えて違えば、カメラの位置が違うとみなして案内する */
const SIZE_NOTICE_RATIO = 0.05;
/** 基準の写真の濃さの初期値（%） */
const DEFAULT_BASE_OPACITY = 50;

/** 記録から、比較に使う情報をまとめる */
function sideOf(opened: OpenedRecord) {
  const { record } = opened;
  const { frames, width, height, fps, durationSec } = record.analysis;
  const size = { width, height };
  const shotSec = shotMarkOf(record.marks)!.timeSec;
  const shotIndex = Math.max(frameIndexAt(frames, shotSec), 0);
  const tiltDeg = tiltDegOfRecord(record);
  const clip = clipOf(record.clip, durationSec);
  // 位置合わせ（揃える）は撃発の瞬間の姿勢で決め、動画の全体を通して動かさない。
  // フレームごとに合わせ直すと、関節の位置の細かい揺れで写真が揺れ、体の動きも打ち消してしまう。
  // 人物を収める範囲は、切り抜きの範囲のコマだけから求める（外した部分で人物が小さく写らないように。最終-21）。
  // 範囲のコマで人物を検出できていなければ渡さない（撃発の瞬間の関節から求める）
  const bounds = sequenceBounds(frames, size, 3, frameRange(frames, clip.startSec, clip.endSec));
  const pose: PoseSide = {
    landmarks: frames[shotIndex]?.landmarks ?? null,
    size,
    tiltDeg,
    handedness: record.meta.handedness,
    ...(bounds ? { bounds } : {}),
  };
  return {
    opened,
    frames,
    size,
    fps,
    shotSec,
    shotIndex,
    tiltDeg,
    pose,
    window: shotWindow(record.clip, durationSec, shotSec),
    clip,
    durationSec,
    recordId: opened.row.id,
  };
}

/**
 * 比較画面の本体（①基準と②比較が決まっているとき）。
 * 2 本の動画を重ね（または横に並べ）、撃発を 0 とした 1 本のバーで 2 本を一緒に動かし、再生・速さ・繰り返しを持つ。
 */
export function CompareView({ base, current, onVideoAttached, onRecordsChanged }: Props) {
  const b = useMemo(() => sideOf(base), [base]);
  const c = useMemo(() => sideOf(current), [current]);
  // 2 本に共通する区間（撃発の前後それぞれ短い方）
  const win = useMemo(() => commonWindow(b.window, c.window), [b, c]);
  // 切り抜きを直すときに動ける最大の範囲：切り抜きを無視した、動画そのものの共通する区間
  const extent = useMemo(
    () =>
      commonWindow(
        shotWindow(null, b.durationSec, b.shotSec),
        shotWindow(null, c.durationSec, c.shotSec),
      ),
    [b, c],
  );

  const [layout, setLayout] = useState<'overlay' | 'side'>('overlay');
  const [align, setAlign] = useState<AlignMode>('normalized');
  const [baseOpacity, setBaseOpacity] = useState(DEFAULT_BASE_OPACITY);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [holding, setHolding] = useState(false);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(false);
  /** バーの時刻（秒）。0 ＝ 撃発。開いた直後は 0 */
  const [t, setT] = useState(0);
  /**
   * 切り抜き範囲の修正（重ねたまま）。撃発を 0 とした開始・終了を 1 組決め、①②の両方に当てはめる
   * （2026-10-03、開発者の希望。片方ずつ別の画面で直すのではなく、重ねた絵を見ながら双方を切る）
   */
  const [clipEdit, setClipEdit] = useState<{ startT: number; endT: number } | null>(null);
  const [clipStatus, setClipStatus] = useState<'none' | 'saving' | 'failed' | ClipProblem>('none');
  /**
   * 撃発ポイントの修正（重ねたまま）。①②それぞれの、試しに動かした撃発ポイント（動画の時刻）を持ち、
   * 「決定」で保存する（2026-10-04、開発者の希望。2 本の撃発ポイントがずれているとき、相手を見ながら揃える）
   */
  const [shotEdit, setShotEdit] = useState<{ role: Role; base: number; current: number } | null>(
    null,
  );
  const [shotStatus, setShotStatus] = useState<'none' | 'saving' | 'failed'>('none');
  const pngExport = useExport();
  /**
   * 「決定」で保存が済み、記録の読み直しを待っている。読み直した記録が届いたら修正を閉じ、時点を 0 に戻す
   * （画面を作り直さずに済ませるため。読み直しの前に閉じると、一瞬だけ古い撃発ポイント・範囲で描いてしまう）
   */
  const [pendingReload, setPendingReload] = useState(false);
  const [seen, setSeen] = useState({ base, current });
  if (seen.base !== base || seen.current !== current) {
    setSeen({ base, current });
    if (pendingReload) {
      setPendingReload(false);
      setClipEdit(null);
      setClipStatus('none');
      setShotEdit(null);
      setShotStatus('none');
      setT(0);
    }
  }
  /** 動画を付け直した側の読み直しの番号（付け直した側だけ読み直す） */
  const [videoVersion, setVideoVersion] = useState<Record<Role, number>>({ base: 0, current: 0 });
  // 0 とする撃発ポイント。修正中は、試しに動かした位置
  const bShot = shotEdit?.base ?? b.shotSec;
  const cShot = shotEdit?.current ?? c.shotSec;
  // 撃発ポイントを直している間に動ける範囲：試しに動かした撃発を 0 とした、切り抜きの共通する区間
  const shotEditWin = useMemo(
    () =>
      commonWindow(
        shotWindow(b.opened.record.clip, b.durationSec, bShot),
        shotWindow(c.opened.record.clip, c.durationSec, cShot),
      ),
    [b, c, bShot, cShot],
  );
  // バーの範囲：ふだんは共通の区間、切り抜きを直している間は動画そのものの共通する区間、
  // 撃発ポイントを直している間は撃発の前後 1 秒（音の山のずれを大きく見せる）
  const bar = shotEdit
    ? {
        start: -Math.min(shotEditWin.beforeSec, SHOT_EDIT_SPAN_SEC),
        end: Math.min(shotEditWin.afterSec, SHOT_EDIT_SPAN_SEC),
      }
    : clipEdit
      ? { start: -extent.beforeSec, end: extent.afterSec }
      : { start: -win.beforeSec, end: win.afterSec };

  const baseVideo = useRecordVideoUrl(base.row.id, videoVersion.base);
  const currentVideo = useRecordVideoUrl(current.row.id, videoVersion.current);
  const baseEnvelope = useAudioEnvelope({
    kind: 'record',
    recordId: base.row.id,
    version: videoVersion.base,
  });
  const currentEnvelope = useAudioEnvelope({
    kind: 'record',
    recordId: current.row.id,
    version: videoVersion.current,
  });
  const baseVideoRef = useRef<HTMLVideoElement | null>(null);
  const currentVideoRef = useRef<HTMLVideoElement | null>(null);
  const setBaseVideo = useCallback((el: HTMLVideoElement | null) => {
    baseVideoRef.current = el;
  }, []);
  const setCurrentVideo = useCallback((el: HTMLVideoElement | null) => {
    currentVideoRef.current = el;
  }, []);

  const baseIndex = nearestFrameIndex(b.frames, bShot + t);
  const currentIndex = nearestFrameIndex(c.frames, cShot + t);

  // 再生は②比較を主にし、①基準を合わせる
  const videos = useMemo<PlaybackVideo[]>(
    () => [
      { get: () => currentVideoRef.current, anchorSec: cShot, fps: c.fps },
      { get: () => baseVideoRef.current, anchorSec: bShot, fps: b.fps },
    ],
    [b, c, bShot, cShot],
  );
  // 再生中の時点はコマの時刻に丸めて持つ（毎フレーム違う値で画面全体を描き直さないため）。
  // 丸めたあとバーの範囲に収める（fps の違う 2 本では、終わりで①の切り抜きの外のコマを指すため。最終-16）
  const barRef = useRef(bar);
  useLayoutEffect(() => {
    barRef.current = bar;
  });
  const onTick = useCallback(
    (next: number) => {
      const rounded = c.frames[nearestFrameIndex(c.frames, cShot + next)]!.timeSec - cShot;
      setT(Math.min(Math.max(rounded, barRef.current.start), barRef.current.end));
    },
    [c, cShot],
  );
  const playback = usePlayback({
    videos,
    startT: bar.start,
    endT: bar.end,
    rate,
    loop,
    onTick,
  });
  const select = (next: number) => {
    // 撃発ポイントの保存中は、静止画を作るために動画を撃発の瞬間に止めているので、時点を動かさない
    if (shotStatus === 'saving') return;
    if (playback.playing) playback.pause();
    setT(Math.min(Math.max(next, bar.start), bar.end));
  };
  /** 撃発を 0 とした時刻を、②比較のコマの時刻に吸着させる */
  const snapT = (next: number) => snapToFrame(c.frames, cShot + next) - cShot;
  const setClipEditSnapped = (startT: number, endT: number) => {
    // 端まで戻せば②の動画の端（保存される範囲と表示を合わせる。最終-27）
    const edges = snapClipEdges(c.frames, cShot + startT, cShot + endT, c.durationSec);
    const s0 = Math.max(edges.startSec - cShot, -extent.beforeSec);
    const e0 = Math.min(edges.endSec - cShot, extent.afterSec);
    if (e0 - s0 >= 1 / c.fps) setClipEdit({ startT: s0, endT: e0 });
  };
  // 「撃発ポイントの修正」「切り抜き範囲の修正」は履歴を 1 つ積み、ブラウザの「戻る」は「やめる」と同じにする
  // （iPhone の画面左端からのスワイプで、修正の途中を失わないため）。「決定」で保存したときも項目を 1 つ戻す
  const nav = useNav();
  /**
   * 「決定」で保存したあとに自分で戻した履歴の合図を 1 回だけ読み飛ばす印。React の状態（pendingReload）は
   * 合図が届くより後に画面へ反映されることがあるので、その場で書ける ref で持つ
   */
  const skipPopRef = useRef(false);
  /** 「決定」で保存が済んだ：読み直しを待ちつつ、修正の履歴の項目を戻す */
  const finishSave = () => {
    setPendingReload(true);
    skipPopRef.current = true;
    nav.back({ view: 'compare' });
  };
  const beginClipEdit = () => {
    playback.pause();
    setClipStatus('none');
    setClipEdit({ startT: -win.beforeSec, endT: win.afterSec });
    nav.push({ view: 'compare', edit: 'clip' });
  };
  /** 切り抜きの修正を閉じ、共通の区間へ戻る */
  const closeClipEdit = () => {
    setClipEdit(null);
    setClipStatus('none');
    if (playback.playing) playback.pause();
    setT(Math.min(Math.max(t, -win.beforeSec), win.afterSec));
  };
  const cancelEdit = () => nav.back({ view: 'compare' });
  /** 決めた開始・終了を、①②それぞれの動画の時刻に直して保存する */
  const saveClips = async () => {
    if (!clipEdit || clipStatus === 'saving') return;
    const sides = [b, c];
    const clips = sides.map((side) => {
      // 端まで戻せば「全体」（最後のコマの時刻に吸着させると 1 コマ分短く記録される。最終-27）
      const clip = snapClipEdges(
        side.frames,
        side.shotSec + clipEdit.startT,
        side.shotSec + clipEdit.endT,
        side.durationSec,
      );
      const whole = clip.startSec <= 0 && clip.endSec >= side.durationSec;
      return { side, clip: whole ? null : clip };
    });
    // 問題の種類（撃発が外・範囲が不正）を捨てずに持ち、案内を分ける
    const problem = clips
      .map(({ side, clip }) => checkClip(clip, side.durationSec, side.shotSec))
      .find((p) => p !== null);
    if (problem) {
      setClipStatus(problem);
      return;
    }
    // 再生したまま決定しても、読み直しのあとの時点（0）が再生に上書きされないように止める
    playback.pause();
    setClipStatus('saving');
    try {
      // 2 件を 1 つのトランザクションで書く（片方だけ書き換わった状態を残さない）
      await updateRecordClipAll(clips.map(({ side, clip }) => ({ id: side.recordId, clip })));
      // 修正を閉じるのは、読み直した記録が届いてから（上の pendingReload）。履歴の項目は先に戻す
      finishSave();
      onRecordsChanged(sides.map((side) => side.recordId));
    } catch {
      setClipStatus('failed');
    }
  };
  const beginShotEdit = () => {
    playback.pause();
    setShotStatus('none');
    setShotEdit({ role: 'current', base: b.shotSec, current: c.shotSec });
    // 撃発の瞬間どうしを見比べるところから始める
    setT(0);
    nav.push({ view: 'compare', edit: 'shot' });
  };
  const closeShotEdit = () => {
    if (playback.playing) playback.pause();
    setShotEdit(null);
    setShotStatus('none');
    setT(0);
  };
  // ブラウザの「戻る」で修正の項目を離れたら「やめる」と同じ。保存の書き込み中は受け付けない（項目を積み直す）。
  // 「決定」のあと読み直しを待っている間は、読み直しが届いたときに閉じる（上の pendingReload）
  useNavListener((entry, source) => {
    if (source !== 'pop' || entry.view !== 'compare') return;
    if (skipPopRef.current) {
      skipPopRef.current = false;
      return;
    }
    const editing = clipEdit ? 'clip' : shotEdit ? 'shot' : undefined;
    if (entry.edit === editing || pendingReload) return;
    if (entry.edit !== undefined) {
      // 「進む」で修正の項目へ来た：作り込まないので、履歴を 1 つ戻して今の状態に留まる
      nav.back({ view: 'compare' });
      return;
    }
    if (editing && (clipStatus === 'saving' || shotStatus === 'saving')) {
      nav.push({ view: 'compare', edit: editing });
      return;
    }
    if (clipEdit) closeClipEdit();
    if (shotEdit) closeShotEdit();
  });
  /** 選んでいる側の撃発ポイントを動かす。動かしたあとは、撃発の瞬間どうしを表示する */
  const moveShot = (next: number | null) => {
    if (!shotEdit || next === null || shotStatus === 'saving') return;
    if (playback.playing) playback.pause();
    setShotEdit({ ...shotEdit, [shotEdit.role]: next });
    setShotStatus('none');
    setT(0);
  };
  /** 動かした側の撃発ポイントを保存する。撃発の瞬間の静止画（詳細と一覧の写真）も作り直す */
  const saveShots = async () => {
    if (!shotEdit || shotStatus === 'saving') return;
    const changed = ROLES.filter((role) =>
      role === 'base' ? shotEdit.base !== b.shotSec : shotEdit.current !== c.shotSec,
    );
    if (changed.length === 0) {
      cancelEdit();
      return;
    }
    playback.pause();
    // 画面の時点も撃発の瞬間に戻す。静止画を作るためのシークと、画面側のシーク（CompareStage は
    // シークが終わるたびに画面の時点へ合わせ直す）の行き先を同じにして、別のコマが撮られないようにする
    setT(0);
    setShotStatus('saving');
    try {
      // 静止画を作ってから、動かした分をまとめて書き込む（片方だけ書き換わった状態を残さない）
      const items = [];
      for (const role of changed) {
        const side = role === 'base' ? b : c;
        const sec = role === 'base' ? shotEdit.base : shotEdit.current;
        const video = (role === 'base' ? baseVideoRef : currentVideoRef).current;
        if (!video || video.readyState < 2) throw new Error('video not ready');
        const images = await captureShotImages(video, side.opened.record.analysis, sec);
        items.push({
          id: side.recordId,
          marks: setShotMark(side.opened.record.marks, sec),
          images,
        });
      }
      await overwriteRecordMarksAll(items);
      // 修正を閉じるのは、読み直した記録が届いてから（上の pendingReload）。履歴の項目は先に戻す
      finishSave();
      onRecordsChanged(items.map((item) => item.id));
    } catch {
      setShotStatus('failed');
    }
  };
  const step = (delta: number) => {
    const frame = c.frames[Math.min(Math.max(currentIndex + delta, 0), c.frames.length - 1)];
    if (frame) select(frame.timeSec - cShot);
  };

  const normalizable = canNormalize(b.pose, c.pose);
  const rawAvailable = sameAspect(b.size, c.size);
  // 位置と大きさを揃えられないときは「撮ったまま」で重ねる。それも無理（縦横比が違う）なら重ねない
  const mode: AlignMode = normalizable ? align : 'raw';
  const cannotOverlay = !normalizable && !rawAvailable;
  const overlay = useMemo(() => overlayLayout(b.pose, c.pose, mode), [b, c, mode]);
  const side = useMemo(() => sideBySideViews(b.pose, c.pose), [b, c]);

  // 角度の差は、止めているときだけ計算して出す（「動画を再生」と同じ）。再生中に毎コマ計算して表を
  // 描き直すと動きが重くなるため（2026-10-04、開発者の指摘）
  const playing = playback.playing;
  const diffs = useMemo(() => {
    if (playing) return null;
    const at = (s: typeof b, index: number) =>
      metricsAtFrame(
        {
          frames: s.frames,
          handedness: s.opened.record.meta.handedness,
          imageWidth: s.size.width,
          imageHeight: s.size.height,
          tiltDeg: s.tiltDeg,
        },
        index,
      );
    const baseMetrics = at(b, baseIndex);
    const currentMetrics = at(c, currentIndex);
    const baseValues = baseMetrics?.values ?? null;
    const currentValues = currentMetrics?.values ?? null;
    return {
      table: baseValues && currentValues ? compareMetrics(baseValues, currentValues) : null,
      // どちらかで左右が逆（銃側の肩が画面の右）なら案内を出す（最終-12）
      sideReversed: Boolean(baseMetrics?.sideReversed || currentMetrics?.sideReversed),
    };
  }, [b, c, baseIndex, currentIndex, playing]);

  const bothVideos = baseVideo.state === 'ready' && currentVideo.state === 'ready';
  // 重ねられない 2 件は、重ねる表示では基準の動画を置かないので、横に並べたときだけ再生できる
  const canPlay =
    bothVideos && !(layout === 'overlay' && cannotOverlay) && bar.end - bar.start >= 1 / c.fps;

  const layerOf = (role: Role, opacity: number): StageLayer => {
    const s = role === 'base' ? b : c;
    const index = role === 'base' ? baseIndex : currentIndex;
    const video = role === 'base' ? baseVideo : currentVideo;
    return {
      key: role,
      size: s.size,
      transform: IDENTITY,
      videoUrl: video.state === 'ready' ? video.url : null,
      timeSec: seekTimeForFrame(s.frames as LandmarkFrame[], index, s.fps),
      // 動画のない記録は、撃発の瞬間だけ、保存してある静止画を出す
      still: video.state === 'none' && index === s.shotIndex ? s.opened.still : null,
      opacity,
      onVideo: role === 'base' ? setBaseVideo : setCurrentVideo,
    };
  };
  const skeleton = (role: Role, view: { width: number; height: number }, onCurrent: boolean) => {
    const s = role === 'base' ? b : c;
    const landmarks = s.frames[role === 'base' ? baseIndex : currentIndex]?.landmarks;
    if (!showSkeleton || !landmarks) return null;
    // 基準を比較の写真の上に描くときは、位置合わせの移し替えで動かす
    const transform = role === 'base' && onCurrent ? overlay.baseTransform : IDENTITY;
    return (
      <SkeletonLayer
        parts={skeletonParts(landmarks, s.size, transform)}
        scale={Math.max(view.width, view.height) / 1000}
        variant={role}
        testId={role === 'base' && onCurrent ? 'still-skeleton-base' : 'still-skeleton'}
      />
    );
  };

  // 重ねるとき：押している間は基準だけ、離すと「比較の上に、基準を半透明で」
  const showBase = !cannotOverlay;
  const overlayLayers: StageLayer[] = [
    layerOf('current', holding && showBase ? 0 : 1),
    ...(showBase
      ? [
          {
            ...layerOf('base', holding ? 1 : baseOpacity / 100),
            transform: overlay.baseTransform,
          },
        ]
      : []),
  ];
  const noVideo = ROLES.filter(
    (role) => (role === 'base' ? baseVideo : currentVideo).state === 'none',
  );
  const sizeGap = overlay.sizeRatio ? Math.abs(overlay.sizeRatio - 1) : 0;
  const atShot = Math.abs(t) < 1 / (2 * c.fps);
  const timeLabel = atShot
    ? ja.compare.atShot
    : t < 0
      ? ja.compare.beforeShot(-t)
      : ja.compare.afterShot(t);

  // 撃発ポイントの修正は、2 本の動画が画面に出ているときだけ（静止画を作り直すのに、その動画を使う）
  const canFixShot = bothVideos && !(layout === 'overlay' && cannotOverlay);
  // PNG の書き出し（重ねた絵）：重ねる表示で、2 本とも絵が出ているとき（動画があるか、動画のない記録なら撃発の瞬間）
  const pngSourceReady = (role: Role) => {
    const s = role === 'base' ? b : c;
    const video = role === 'base' ? baseVideo : currentVideo;
    const index = role === 'base' ? baseIndex : currentIndex;
    return video.state === 'ready' || (video.state === 'none' && index === s.shotIndex);
  };
  const pngOverlay = layout === 'overlay' && !cannotOverlay;
  const pngSources = pngSourceReady('base') && pngSourceReady('current');
  const canExportPng = pngOverlay && pngSources;
  /** 重ねた絵を、②比較の動画の画素で描き直して PNG にする（帯に①②のタイトルと時点） */
  const exportPng = () =>
    void pngExport.run(async () => {
      playback.pause();
      const loaded: LoadedImage[] = [];
      try {
        const layerFor = async (role: Role, opacity: number, transform: typeof IDENTITY) => {
          const s = role === 'base' ? b : c;
          const video = role === 'base' ? baseVideo : currentVideo;
          let source: CanvasImageSource;
          if (video.state === 'ready') {
            const el = (role === 'base' ? baseVideoRef : currentVideoRef).current;
            if (!el) throw new Error('video not ready');
            // シークの途中なら、終わって狙ったコマが出るまで待つ
            await waitVideoSettled(el);
            source = el;
          } else {
            const img = await imageFromBytes(s.opened.still.bytes, s.opened.still.type);
            loaded.push(img);
            source = img.image;
          }
          return { source, size: s.size, transform, opacity } satisfies PngLayer;
        };
        const layers = [
          await layerFor('current', 1, IDENTITY),
          await layerFor('base', baseOpacity / 100, overlay.baseTransform),
        ];
        const skeletons: PngSkeleton[] = [];
        for (const role of ROLES) {
          const s = role === 'base' ? b : c;
          const landmarks = s.frames[role === 'base' ? baseIndex : currentIndex]?.landmarks;
          if (!landmarks) continue;
          const transform = role === 'base' ? overlay.baseTransform : IDENTITY;
          skeletons.push({ parts: skeletonParts(landmarks, s.size, transform), variant: role });
        }
        const canvas = drawOverlay({
          view: overlay.view,
          layers,
          skeletons,
          title: ja.export.pngTitle(base.row.title, current.row.title, timeLabel),
        });
        return {
          blob: await canvasToPng(canvas),
          name: compareFileName(base.row.title, current.row.title),
        };
      } finally {
        loaded.forEach((l) => l.release());
      }
    });
  // 撃発ポイントの修正で、いま動かす側
  const editSide = shotEdit?.role === 'base' ? b : c;
  const editShot = shotEdit?.role === 'base' ? bShot : cShot;
  const editEnvelope = shotEdit?.role === 'base' ? baseEnvelope : currentEnvelope;
  // 「音の山に合わせる」の行き先（その動画の撃発の前後 1 秒で、音が最大の時点に近いコマ）
  const editPeak =
    shotEdit && editEnvelope.state === 'ready'
      ? peakShot(editEnvelope.envelope, editSide.frames, editShot, editSide.clip)
      : null;
  // 修正中でなければ計算しない（再生中は毎コマここを通るため）
  const editEarlier = shotEdit ? shiftShot(editSide.frames, editShot, -1, editSide.clip) : editShot;
  const editLater = shotEdit ? shiftShot(editSide.frames, editShot, 1, editSide.clip) : editShot;
  const savingShot = shotStatus === 'saving';

  // 音のグラフ：2 本分を、撃発が 0 になるようずらして重ねる
  const waves: WaveSeries[] = [];
  if (baseEnvelope.state === 'ready') {
    waves.push({
      key: 'base',
      envelope: baseEnvelope.envelope,
      shiftSec: -bShot,
      className: 'wave-base',
    });
  }
  if (currentEnvelope.state === 'ready') {
    waves.push({
      key: 'current',
      envelope: currentEnvelope.envelope,
      shiftSec: -cShot,
      className: 'wave-current',
    });
  }

  return (
    <>
      {layout === 'overlay' ? (
        <div data-testid="compare-overlay" data-align={mode} data-holding={holding}>
          <CompareStage
            view={overlay.view}
            layers={overlayLayers}
            {...(showBase ? { onHold: setHolding } : {})}
            label={ja.compare.overlayAlt}
            testId="still"
          >
            {showBase && skeleton('base', overlay.view, true)}
            {!(holding && showBase) && skeleton('current', overlay.view, true)}
          </CompareStage>
          {showBase && <p className="muted small photo-note">{ja.compare.holdNote}</p>}
        </div>
      ) : (
        <div className="side-by-side" data-testid="compare-side">
          {ROLES.map((role) => {
            const view = role === 'base' ? side.base : side.current;
            return (
              <div key={role}>
                <p className="pair-role">
                  <span className={`skeleton-key ${role}`} aria-hidden="true" />
                  {roleName(role)}
                </p>
                <CompareStage
                  view={view}
                  layers={[layerOf(role, 1)]}
                  label={roleName(role)}
                  testId={`still-${role}`}
                >
                  {skeleton(role, view, false)}
                </CompareStage>
              </div>
            );
          })}
        </div>
      )}

      {layout === 'overlay' && showBase && (
        <label className="opacity-row">
          <span className="small">{ja.compare.baseOpacity}</span>
          <input
            type="range"
            className="slider"
            data-testid="base-opacity"
            min={0}
            max={100}
            step={5}
            value={baseOpacity}
            onChange={(e) => setBaseOpacity(Number(e.target.value))}
          />
        </label>
      )}
      <div className="chips spaced">
        <button
          className="chip"
          data-testid="toggle-skeleton"
          aria-pressed={showSkeleton}
          onClick={() => setShowSkeleton(!showSkeleton)}
        >
          {ja.compare.showSkeleton}
        </button>
        <button
          className="chip"
          data-testid="toggle-side"
          aria-pressed={layout === 'side'}
          disabled={savingShot}
          onClick={() => {
            // 切り替えると動画の部品が作り直されるので、先に止めて、いまの時点を保つ
            playback.pause();
            setLayout(layout === 'side' ? 'overlay' : 'side');
          }}
        >
          {ja.compare.layoutSide}
        </button>
      </div>

      {noVideo.length > 0 && (
        <div className="notice" data-testid="compare-no-video">
          <strong>
            {noVideo.length === 2
              ? ja.compare.noVideoBoth
              : ja.compare.noVideoOne(roleName(noVideo[0]!))}
          </strong>
          <p className="small">{ja.compare.noVideoBody}</p>
          <div className="stack">
            {noVideo.map((role) => {
              const opened = role === 'base' ? base : current;
              return (
                <div key={role}>
                  <p className="small">{ja.compare.attachFor(roleName(role))}</p>
                  <AttachVideo
                    recordId={opened.row.id}
                    analysis={opened.record.analysis}
                    onAttached={() => {
                      onVideoAttached(role);
                      setVideoVersion((v) => ({ ...v, [role]: v[role] + 1 }));
                    }}
                    testId={`attach-${role}`}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p
        className="muted small num player-time"
        data-testid="compare-time"
        data-base-index={baseIndex}
        data-current-index={currentIndex}
        data-base-sec={b.frames[baseIndex]?.timeSec}
        data-current-sec={c.frames[currentIndex]?.timeSec}
      >
        {timeLabel}
      </p>
      <WaveBar
        startSec={bar.start}
        endSec={bar.end}
        valueSec={t}
        stepSec={1 / c.fps}
        onChange={select}
        waves={waves}
        noAudio={baseEnvelope.state === 'none' && currentEnvelope.state === 'none'}
        markers={[{ key: 'shot', sec: 0, label: ja.compare.shotMarker }]}
        {...(clipEdit
          ? {
              handles: {
                startSec: clipEdit.startT,
                endSec: clipEdit.endT,
                onChange: setClipEditSnapped,
                snap: snapT,
              },
            }
          : {})}
        startLabel={ja.compare.relLabel(bar.start)}
        endLabel={ja.compare.relLabel(bar.end)}
        ariaLabel={ja.compare.timeSlider}
        testId="compare-bar"
      />
      {clipEdit && (
        <div className="notice" data-testid="compare-clip-edit">
          <strong>{ja.compare.clipEditTitle}</strong>
          <p className="small">{ja.compare.clipEditBody}</p>
          <div className="row nowrap">
            <button
              data-testid="clip-set-start"
              onClick={() => setClipEditSnapped(t, Math.max(clipEdit.endT, t + 1 / c.fps))}
            >
              {ja.clip.setStart}
            </button>
            <button
              data-testid="clip-set-end"
              onClick={() => setClipEditSnapped(Math.min(clipEdit.startT, t - 1 / c.fps), t)}
            >
              {ja.clip.setEnd}
            </button>
          </div>
          <p className="small num" data-testid="clip-length">
            {ja.compare.clipEditRange(clipEdit.startT, clipEdit.endT)}
          </p>
          {clipStatus === 'shotOutsideClip' && (
            <p className="danger small">{ja.clip.shotOutside}</p>
          )}
          {clipStatus === 'invalidClip' && <p className="danger small">{ja.clip.invalid}</p>}
          {clipStatus === 'failed' && <p className="danger small">{ja.library.fixFailed}</p>}
          <div className="row nowrap">
            <button
              data-testid="clip-cancel"
              disabled={clipStatus === 'saving'}
              onClick={cancelEdit}
            >
              {ja.common.cancel}
            </button>
            <button
              className="primary grow"
              data-testid="clip-confirm"
              disabled={clipStatus === 'saving'}
              onClick={() => void saveClips()}
            >
              {clipStatus === 'saving' ? ja.save.saving : ja.common.decide}
            </button>
          </div>
        </div>
      )}
      {shotEdit && (
        <div
          className="notice"
          data-testid="compare-shot-edit"
          data-role={shotEdit.role}
          data-base-shot={shotEdit.base.toFixed(3)}
          data-current-shot={shotEdit.current.toFixed(3)}
        >
          <strong>{ja.compare.shotEditTitle}</strong>
          <p className="small">{ja.compare.shotEditBody}</p>
          <div className="seg">
            {ROLES.map((role, i) => (
              <button
                key={role}
                data-testid={`shot-edit-role-${role}`}
                aria-pressed={shotEdit.role === role}
                disabled={savingShot}
                onClick={() => setShotEdit({ ...shotEdit, role })}
              >
                {ja.compare.shotEditRole((i + 1) as 1 | 2, roleName(role))}
              </button>
            ))}
          </div>
          <div className="row nowrap">
            <button
              className="grow"
              data-testid="shot-edit-earlier"
              disabled={savingShot || editEarlier === editShot}
              onClick={() => moveShot(editEarlier)}
            >
              {ja.compare.shotEarlier}
            </button>
            <button
              className="grow"
              data-testid="shot-edit-later"
              disabled={savingShot || editLater === editShot}
              onClick={() => moveShot(editLater)}
            >
              {ja.compare.shotLater}
            </button>
          </div>
          <button
            className="full"
            data-testid="shot-edit-peak"
            disabled={savingShot || editPeak === null || editPeak === editShot}
            onClick={() => moveShot(editPeak)}
          >
            {ja.compare.shotToPeak}
          </button>
          {editEnvelope.state === 'none' && (
            <p className="muted small" data-testid="shot-edit-no-audio">
              {ja.compare.shotToPeakNoAudio}
            </p>
          )}
          {ROLES.map((role, i) => {
            const s = role === 'base' ? b : c;
            const to = role === 'base' ? shotEdit.base : shotEdit.current;
            return (
              <p key={role} className="small num" data-testid={`shot-edit-line-${role}`}>
                {ja.compare.shotEditLine(
                  (i + 1) as 1 | 2,
                  roleName(role),
                  s.shotSec,
                  to,
                  shotFrameDelta(s.frames, s.shotSec, to),
                )}
              </p>
            );
          })}
          {shotStatus === 'failed' && <p className="danger small">{ja.library.fixFailed}</p>}
          {!canFixShot && (
            <p className="muted small" data-testid="shot-edit-needs-side">
              {ja.compare.shotEditNeedsSide}
            </p>
          )}
          <div className="row nowrap">
            <button data-testid="shot-edit-cancel" disabled={savingShot} onClick={cancelEdit}>
              {ja.common.cancel}
            </button>
            <button
              className="primary grow"
              data-testid="shot-edit-confirm"
              disabled={savingShot || !canFixShot}
              onClick={() => void saveShots()}
            >
              {savingShot ? ja.save.saving : ja.common.decide}
            </button>
          </div>
        </div>
      )}
      <TransportControls
        playing={playback.playing}
        onPlay={() => playback.play()}
        onPause={playback.pause}
        onPrev={() => step(-1)}
        onNext={() => step(1)}
        canPrev={t > bar.start + 1e-6}
        canNext={t < bar.end - 1e-6}
        canPlay={canPlay && !savingShot}
        transport={{ rate, loop, onRate: setRate, onLoop: setLoop }}
        testId="compare"
      />
      {!bothVideos && noVideo.length > 0 && (
        <p className="muted small">{ja.compare.playUnavailable}</p>
      )}
      {bothVideos && !canPlay && (
        <p className="muted small" data-testid="play-reason">
          {ja.compare.playNeedsSide}
        </p>
      )}

      {layout === 'overlay' && cannotOverlay && (
        <div className="notice" data-testid="compare-cannot-overlay">
          <strong>{ja.compare.cannotOverlayTitle}</strong>
          <p className="small">{ja.compare.cannotOverlayBody}</p>
        </div>
      )}
      {layout === 'overlay' && !cannotOverlay && (
        <>
          <div className="seg spaced">
            <button
              data-testid="align-normalized"
              aria-pressed={mode === 'normalized'}
              disabled={!normalizable}
              onClick={() => setAlign('normalized')}
            >
              {ja.compare.alignNormalized}
            </button>
            <button
              data-testid="align-raw"
              aria-pressed={mode === 'raw'}
              disabled={!rawAvailable && normalizable}
              onClick={() => setAlign('raw')}
            >
              {ja.compare.alignRaw}
            </button>
          </div>
          {!normalizable && (
            <p className="muted small" data-testid="align-normalized-reason">
              {ja.compare.normalizedUnavailable}
            </p>
          )}
          {!rawAvailable && (
            <p className="muted small" data-testid="align-raw-reason">
              {ja.compare.rawUnavailable}
            </p>
          )}
          <p className="muted small">
            {mode === 'normalized' ? ja.compare.normalizedNote : ja.compare.rawNote}
          </p>
          {mode === 'raw' && normalizable && sizeGap > SIZE_NOTICE_RATIO && (
            <div className="notice" data-testid="compare-camera-moved">
              <strong>{ja.compare.cameraMovedTitle}</strong>
              <p className="small">{ja.compare.cameraMovedBody(Math.round(sizeGap * 100))}</p>
            </div>
          )}
        </>
      )}
      {layout === 'side' && <p className="muted small">{ja.compare.sideNote}</p>}

      <div className="stack spaced">
        <button
          className="full"
          data-testid="compare-fix-shot"
          aria-pressed={shotEdit !== null}
          disabled={!canFixShot || shotEdit !== null || clipEdit !== null}
          onClick={beginShotEdit}
        >
          {ja.compare.fixShot}
        </button>
        <button
          className="full"
          data-testid="compare-fix-clip"
          aria-pressed={clipEdit !== null}
          disabled={!bothVideos || clipEdit !== null || shotEdit !== null}
          onClick={beginClipEdit}
        >
          {ja.compare.fixClip}
        </button>
        <button
          className="full"
          data-testid="compare-export-png"
          // 再生中は押せない（止めた瞬間の絵と、時点から求めた骨格のコマがずれることがあるため）
          disabled={!canExportPng || pngExport.status === 'busy' || savingShot || playing}
          onClick={exportPng}
        >
          {ja.export.png}
        </button>
        {cannotOverlay ? (
          <p className="muted small" data-testid="png-reason">
            {ja.export.pngCannotOverlay}
          </p>
        ) : !pngOverlay ? (
          <p className="muted small" data-testid="png-reason">
            {ja.export.pngNeedsOverlay}
          </p>
        ) : (
          !pngSources && (
            <p className="muted small" data-testid="png-reason">
              {ja.export.pngNeedsVideo}
            </p>
          )
        )}
        <ExportStatusLine
          status={pngExport.status}
          onShare={pngExport.share}
          testId="compare-export-status"
        />
      </div>

      <NumbersFold title={ja.compare.numbersTitle} testId="diff-numbers">
        {playing ? (
          <p className="muted small" data-testid="diff-playing">
            {ja.compare.diffPlaying}
          </p>
        ) : (
          <>
            <p className="muted small num" data-testid="diff-times">
              {ja.compare.tableTimes(timeLabel)}
            </p>
            {diffs?.sideReversed && (
              <p className="danger small" data-testid="diff-side-reversed">
                {ja.metricTable.sideReversed}
              </p>
            )}
            {diffs?.table ? (
              <DiffTable diffs={diffs.table} testId="diff-table" />
            ) : (
              <p className="danger small" data-testid="diff-none">
                {ja.metricTable.noPerson}
              </p>
            )}
          </>
        )}
      </NumbersFold>
    </>
  );
}
