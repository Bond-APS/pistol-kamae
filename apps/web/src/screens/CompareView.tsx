import {
  IDENTITY,
  clipOf,
  commonWindow,
  compareMetrics,
  frameIndexAt,
  metricsAtFrame,
  shotMarkOf,
  shotWindow,
  tiltDegOfRecord,
  type LandmarkFrame,
} from '@pistol-kamae/engine';
import { useCallback, useMemo, useRef, useState } from 'react';
import { nearestFrameIndex, seekTimeForFrame } from '../analysis/frames';
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
import { NumbersFold } from '../components/NumbersFold';
import { skeletonParts } from '../components/skeleton';
import { SkeletonLayer } from '../components/SkeletonLayer';
import { TransportControls } from '../components/TransportControls';
import { useRecordVideoUrl } from '../components/useRecordVideoUrl';
import { WaveBar, type WaveSeries } from '../components/WaveBar';
import type { OpenedRecord } from '../db/library';
import { ja } from '../i18n/ja';
import { usePlayback, type PlaybackVideo } from '../video/usePlayback';
import type { PlayerMode } from './RecordPlayer';

interface Props {
  base: OpenedRecord;
  current: OpenedRecord;
  /** 「撃発ポイントの修正」「切り抜き範囲の修正」で、どちらかの動画を直す画面を開く */
  onFix: (role: Role, mode: PlayerMode) => void;
  /** 動画を付け直したとき */
  onVideoAttached: (role: Role) => void;
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
  // 位置合わせ（揃える）は撃発の瞬間の姿勢で決め、動画の全体を通して動かさない。
  // フレームごとに合わせ直すと、関節の位置の細かい揺れで写真が揺れ、体の動きも打ち消してしまう
  const pose: PoseSide = {
    landmarks: frames[shotIndex]?.landmarks ?? null,
    size,
    tiltDeg,
    handedness: record.meta.handedness,
    bounds: sequenceBounds(frames, size),
  };
  const clip = clipOf(record.clip, durationSec);
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
  };
}

/**
 * 比較画面の本体（①基準と②比較が決まっているとき）。
 * 2 本の動画を重ね（または横に並べ）、撃発を 0 とした 1 本のバーで 2 本を一緒に動かし、再生・速さ・繰り返しを持つ。
 */
export function CompareView({ base, current, onFix, onVideoAttached }: Props) {
  const b = useMemo(() => sideOf(base), [base]);
  const c = useMemo(() => sideOf(current), [current]);
  // 2 本に共通する区間（撃発の前後それぞれ短い方）
  const win = useMemo(() => commonWindow(b.window, c.window), [b, c]);

  const [layout, setLayout] = useState<'overlay' | 'side'>('overlay');
  const [align, setAlign] = useState<AlignMode>('normalized');
  const [baseOpacity, setBaseOpacity] = useState(DEFAULT_BASE_OPACITY);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [holding, setHolding] = useState(false);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(false);
  /** バーの時刻（秒）。0 ＝ 撃発。開いた直後は 0 */
  const [t, setT] = useState(0);
  const [fixing, setFixing] = useState<PlayerMode | null>(null);

  const baseVideo = useRecordVideoUrl(base.row.id, 0);
  const currentVideo = useRecordVideoUrl(current.row.id, 0);
  const baseEnvelope = useAudioEnvelope({ kind: 'record', recordId: base.row.id });
  const currentEnvelope = useAudioEnvelope({ kind: 'record', recordId: current.row.id });
  const baseVideoRef = useRef<HTMLVideoElement | null>(null);
  const currentVideoRef = useRef<HTMLVideoElement | null>(null);
  const setBaseVideo = useCallback((el: HTMLVideoElement | null) => {
    baseVideoRef.current = el;
  }, []);
  const setCurrentVideo = useCallback((el: HTMLVideoElement | null) => {
    currentVideoRef.current = el;
  }, []);

  const baseIndex = nearestFrameIndex(b.frames, b.shotSec + t);
  const currentIndex = nearestFrameIndex(c.frames, c.shotSec + t);

  // 再生は②比較を主にし、①基準を合わせる
  const videos = useMemo<PlaybackVideo[]>(
    () => [
      { get: () => currentVideoRef.current, anchorSec: c.shotSec, fps: c.fps },
      { get: () => baseVideoRef.current, anchorSec: b.shotSec, fps: b.fps },
    ],
    [b, c],
  );
  // 再生中の時点はコマの時刻に丸めて持つ（毎フレーム違う値で画面全体を描き直さないため）
  const onTick = useCallback(
    (next: number) =>
      setT(c.frames[nearestFrameIndex(c.frames, c.shotSec + next)]!.timeSec - c.shotSec),
    [c],
  );
  const playback = usePlayback({
    videos,
    startT: -win.beforeSec,
    endT: win.afterSec,
    rate,
    loop,
    onTick,
  });
  const select = (next: number) => {
    if (playback.playing) playback.pause();
    setT(Math.min(Math.max(next, -win.beforeSec), win.afterSec));
  };
  const step = (delta: number) => {
    const frame = c.frames[Math.min(Math.max(currentIndex + delta, 0), c.frames.length - 1)];
    if (frame) select(frame.timeSec - c.shotSec);
  };

  const normalizable = canNormalize(b.pose, c.pose);
  const rawAvailable = sameAspect(b.size, c.size);
  // 位置と大きさを揃えられないときは「撮ったまま」で重ねる。それも無理（縦横比が違う）なら重ねない
  const mode: AlignMode = normalizable ? align : 'raw';
  const cannotOverlay = !normalizable && !rawAvailable;
  const overlay = useMemo(() => overlayLayout(b.pose, c.pose, mode), [b, c, mode]);
  const side = useMemo(() => sideBySideViews(b.pose, c.pose), [b, c]);

  const diffs = useMemo(() => {
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
      )?.values ?? null;
    const baseValues = at(b, baseIndex);
    const currentValues = at(c, currentIndex);
    return baseValues && currentValues ? compareMetrics(baseValues, currentValues) : null;
  }, [b, c, baseIndex, currentIndex]);

  const bothVideos = baseVideo.state === 'ready' && currentVideo.state === 'ready';
  // 重ねられない 2 件は、重ねる表示では基準の動画を置かないので、横に並べたときだけ再生できる
  const canPlay =
    bothVideos &&
    !(layout === 'overlay' && cannotOverlay) &&
    win.beforeSec + win.afterSec >= 1 / c.fps;

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

  // 音のグラフ：2 本分を、撃発が 0 になるようずらして重ねる
  const waves: WaveSeries[] = [];
  if (baseEnvelope.state === 'ready') {
    waves.push({
      key: 'base',
      envelope: baseEnvelope.envelope,
      shiftSec: -b.shotSec,
      className: 'wave-base',
    });
  }
  if (currentEnvelope.state === 'ready') {
    waves.push({
      key: 'current',
      envelope: currentEnvelope.envelope,
      shiftSec: -c.shotSec,
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
                    onAttached={() => onVideoAttached(role)}
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
      >
        {timeLabel}
      </p>
      <WaveBar
        startSec={-win.beforeSec}
        endSec={win.afterSec}
        valueSec={t}
        stepSec={1 / c.fps}
        onChange={select}
        waves={waves}
        noAudio={baseEnvelope.state === 'none' && currentEnvelope.state === 'none'}
        markers={[{ key: 'shot', sec: 0, label: ja.compare.shotMarker }]}
        startLabel={ja.compare.relLabel(-win.beforeSec)}
        endLabel={ja.compare.relLabel(win.afterSec)}
        ariaLabel={ja.compare.timeSlider}
        testId="compare-bar"
      />
      <TransportControls
        playing={playback.playing}
        onPlay={() => playback.play()}
        onPause={playback.pause}
        onPrev={() => step(-1)}
        onNext={() => step(1)}
        canPrev={t > -win.beforeSec + 1e-6}
        canNext={t < win.afterSec - 1e-6}
        canPlay={canPlay}
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
        {(['shot', 'clip'] as const).map((m) => (
          <button
            key={m}
            className="full"
            data-testid={`compare-fix-${m}`}
            aria-expanded={fixing === m}
            disabled={!bothVideos}
            onClick={() => {
              playback.pause();
              setFixing(fixing === m ? null : m);
            }}
          >
            {m === 'shot' ? ja.compare.fixShot : ja.compare.fixClip}
          </button>
        ))}
      </div>
      {fixing && (
        <div className="notice" data-testid="compare-fix-which">
          <strong>{ja.compare.fixWhich}</strong>
          <div className="stack">
            {ROLES.map((role, i) => (
              <button
                key={role}
                className="full"
                data-testid={`compare-fix-${role}`}
                onClick={() => onFix(role, fixing)}
              >
                {ja.compare.fixRole(
                  (i + 1) as 1 | 2,
                  roleName(role),
                  (role === 'base' ? base : current).row.title,
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      <NumbersFold title={ja.compare.numbersTitle} testId="diff-numbers">
        <p className="muted small num" data-testid="diff-times">
          {ja.compare.tableTimes(timeLabel)}
        </p>
        {diffs ? (
          <DiffTable diffs={diffs} testId="diff-table" />
        ) : (
          <p className="danger small" data-testid="diff-none">
            {ja.metricTable.noPerson}
          </p>
        )}
      </NumbersFold>
    </>
  );
}
