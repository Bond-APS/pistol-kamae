import {
  IDENTITY,
  compareMetrics,
  frameIndexAt,
  metricsAtFrame,
  shotMarkOf,
  tiltDegOfRecord,
  type LandmarkFrame,
} from '@pistol-kamae/engine';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { seekTimeForFrame } from '../analysis/frames';
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
import { skeletonParts } from '../components/skeleton';
import { SkeletonLayer } from '../components/SkeletonLayer';
import { relativeTimeLabel } from '../components/relativeTime';
import { TimeBar } from '../components/TimeBar';
import { useRecordVideoUrl } from '../components/useRecordVideoUrl';
import type { OpenedRecord } from '../db/library';
import { ja } from '../i18n/ja';

interface Props {
  base: OpenedRecord;
  current: OpenedRecord;
}

type Role = 'base' | 'current';
const ROLES: readonly Role[] = ['base', 'current'];
const roleName = (role: Role): string => (role === 'base' ? ja.compare.base : ja.compare.current);

/** 人物の大きさがこの割合を超えて違えば、カメラの位置が違うとみなして案内する */
const SIZE_NOTICE_RATIO = 0.05;
/** 基準の写真の濃さの初期値（%） */
const DEFAULT_BASE_OPACITY = 50;

/** 記録から、比較に使う情報をまとめる */
function sideOf(opened: OpenedRecord) {
  const { record } = opened;
  const { frames, width, height, fps } = record.analysis;
  const size = { width, height };
  const shot = shotMarkOf(record.marks);
  const shotIndex = shot ? Math.max(frameIndexAt(frames, shot.timeSec), 0) : 0;
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
  return { opened, frames, size, fps, shotIndex, tiltDeg, pose };
}

/** フレームの時刻（秒） */
const timeOf = (frames: ReadonlyArray<LandmarkFrame>, index: number): number =>
  frames[index]?.timeSec ?? 0;

/**
 * 比較画面の本体（基準と今回の 2 件が決まっているとき）。
 * 2 本の動画を重ね（または横に並べ）、それぞれ別のバーで時点を選び、その時点どうしの角度の差を表で示す。
 */
export function CompareView({ base, current }: Props) {
  const b = useMemo(() => sideOf(base), [base]);
  const c = useMemo(() => sideOf(current), [current]);

  const [layout, setLayout] = useState<'overlay' | 'side'>('overlay');
  const [align, setAlign] = useState<AlignMode>('normalized');
  const [baseOpacity, setBaseOpacity] = useState(DEFAULT_BASE_OPACITY);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [holding, setHolding] = useState(false);
  /**
   * 「2 本を一緒に動かす」のとき、入れた瞬間の時刻の差（今回 − 基準、秒）。切ってあれば null。
   * 動かすたびの差分を積み上げると、端に当たったときや丸めで対応がずれるので、最初の差を保つ
   */
  const [linkOffset, setLinkOffset] = useState<number | null>(null);
  const linked = linkOffset !== null;
  const [playing, setPlaying] = useState(false);
  /** 表示中のフレーム番号。開いた直後はどちらも撃発の瞬間 */
  const [baseIndex, setBaseIndex] = useState(b.shotIndex);
  const [currentIndex, setCurrentIndex] = useState(c.shotIndex);
  /** 動画を付け直したら増やし、その記録の動画だけを読み直す */
  const [videoVersion, setVideoVersion] = useState({ base: 0, current: 0 });

  const baseVideo = useRecordVideoUrl(base.row.id, videoVersion.base);
  const currentVideo = useRecordVideoUrl(current.row.id, videoVersion.current);
  const baseVideoRef = useRef<HTMLVideoElement | null>(null);
  const currentVideoRef = useRef<HTMLVideoElement | null>(null);
  const setBaseVideo = useCallback((el: HTMLVideoElement | null) => {
    baseVideoRef.current = el;
  }, []);
  const setCurrentVideo = useCallback((el: HTMLVideoElement | null) => {
    currentVideoRef.current = el;
  }, []);

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

  /** 動画がいま表示しているコマに、骨格・バー・差分表を合わせる（読み込み前の動画は無視する） */
  const syncIndices = useCallback(() => {
    const bv = baseVideoRef.current;
    const cv = currentVideoRef.current;
    if (bv && bv.readyState >= 2) setBaseIndex(Math.max(frameIndexAt(b.frames, bv.currentTime), 0));
    if (cv && cv.readyState >= 2) {
      setCurrentIndex(Math.max(frameIndexAt(c.frames, cv.currentTime), 0));
    }
  }, [b, c]);
  const pause = useCallback(() => {
    const wasPlaying = [baseVideoRef.current, currentVideoRef.current].some((v) => v && !v.paused);
    baseVideoRef.current?.pause();
    currentVideoRef.current?.pause();
    // 止めた位置のコマに合わせる（最後に合わせてから進んだ分のずれを残さない）
    if (wasPlaying) syncIndices();
    setPlaying(false);
  }, [syncIndices]);

  /** バーなどで時点を選ぶ。「2 本を一緒に動かす」なら、もう片方も同じ秒数だけ動かす */
  const select = (role: Role, index: number) => {
    pause();
    const [own, other] = role === 'base' ? [b, c] : [c, b];
    const [setOwn, setOther] =
      role === 'base' ? [setBaseIndex, setCurrentIndex] : [setCurrentIndex, setBaseIndex];
    setOwn(index);
    if (linkOffset !== null) {
      const own_t = timeOf(own.frames, index);
      const target = role === 'base' ? own_t + linkOffset : own_t - linkOffset;
      const last = other.frames.length - 1;
      setOther(Math.min(Math.max(frameIndexAt(other.frames, Math.max(target, 0)), 0), last));
    }
  };
  const toggleLinked = () =>
    setLinkOffset(linked ? null : timeOf(c.frames, currentIndex) - timeOf(b.frames, baseIndex));

  // 再生中は、動画の進みに合わせて骨格・バー・差分表を動かす
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const bv = baseVideoRef.current;
      const cv = currentVideoRef.current;
      // どちらかが終わりまで行った・止まった・画面から外れたら、両方止める
      if (!bv || !cv || bv.ended || cv.ended || bv.paused || cv.paused) {
        pause();
        return;
      }
      syncIndices();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, pause, syncIndices]);
  // 画面を離れるときは止める
  useEffect(
    () => () => {
      baseVideoRef.current?.pause();
      currentVideoRef.current?.pause();
    },
    [],
  );

  const bothVideos = baseVideo.state === 'ready' && currentVideo.state === 'ready';
  // 重ねられない 2 件は、重ねる表示では基準の動画を置かないので、横に並べたときだけ再生できる
  const canPlay = bothVideos && !(layout === 'overlay' && cannotOverlay);
  const play = () => {
    const bv = baseVideoRef.current;
    const cv = currentVideoRef.current;
    if (!bv || !cv) return;
    // 利用者の操作（このボタンを押したこと）の中で、2 本を同時に再生し始める
    void Promise.all([bv.play(), cv.play()]).then(
      () => setPlaying(true),
      () => pause(),
    );
  };

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
    // 基準を今回の写真の上に描くときは、位置合わせの移し替えで動かす
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

  // 重ねるとき：押している間は基準だけ、離すと「今回の上に、基準を半透明で」
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
  const atShot = baseIndex === b.shotIndex && currentIndex === c.shotIndex;

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
            pause();
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
                    onAttached={() => setVideoVersion((v) => ({ ...v, [role]: v[role] + 1 }))}
                    testId={`attach-${role}`}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      <TimeBar
        role="base"
        frames={b.frames}
        index={baseIndex}
        shotIndex={b.shotIndex}
        onChange={(i) => select('base', i)}
      />
      <TimeBar
        role="current"
        frames={c.frames}
        index={currentIndex}
        shotIndex={c.shotIndex}
        onChange={(i) => select('current', i)}
      />
      <div className="row">
        <button
          className="chip"
          data-testid="toggle-linked"
          aria-pressed={linked}
          onClick={toggleLinked}
        >
          {ja.compare.linked}
        </button>
        <button
          data-testid="compare-play"
          disabled={!canPlay}
          onClick={() => (playing ? pause() : play())}
        >
          {playing ? ja.player.pause : ja.compare.playBoth}
        </button>
      </div>
      {!bothVideos && noVideo.length > 0 && (
        <p className="muted small">{ja.compare.playUnavailable}</p>
      )}
      {bothVideos && !canPlay && (
        <p className="muted small" data-testid="play-reason">
          {ja.compare.playNeedsSide}
        </p>
      )}
      {linked && <p className="muted small">{ja.compare.linkedNote}</p>}

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

      <h3 data-testid="diff-title">{atShot ? ja.compare.tableTitle : ja.compare.tableTitleAt}</h3>
      <p className="muted small num" data-testid="diff-times">
        {ja.compare.tableTimes(
          relativeTimeLabel(b.frames, baseIndex, b.shotIndex),
          relativeTimeLabel(c.frames, currentIndex, c.shotIndex),
        )}
      </p>
      {diffs ? (
        <DiffTable diffs={diffs} testId="diff-table" />
      ) : (
        <p className="danger small" data-testid="diff-none">
          {ja.metricTable.noPerson}
        </p>
      )}
    </>
  );
}
