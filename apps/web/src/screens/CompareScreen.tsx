import {
  bodyAnchor,
  compareMetrics,
  formatScore,
  frameIndexAt,
  parseLocalDateTime,
  shotMarkOf,
  shotMetricsOfRecord,
  tiltDegOfRecord,
  type LevelLine,
} from '@pistol-kamae/engine';
import { useEffect, useMemo, useState } from 'react';
import { canNormalize, overlayLayout, sameAspect, sideBySideViews } from '../compare/layout';
import type { AlignMode, PoseSide } from '../compare/layout';
import { DiffTable } from '../components/DiffTable';
import { LevelEditor } from '../components/LevelEditor';
import { RecordPicker } from '../components/RecordPicker';
import { skeletonParts } from '../components/skeleton';
import { StillView } from '../components/StillView';
import { StoredImg } from '../components/StoredImg';
import { openRecord, setRecordLevel, type ComparePair, type OpenedRecord } from '../db/library';
import type { ShooterRow } from '../db/schema';
import { ja } from '../i18n/ja';

interface Props {
  shooters: ShooterRow[];
  /** 比べる 2 件（基準と今回）。App が持ち、端末に覚えておく */
  pair: ComparePair;
  onPairChange: (pair: ComparePair) => void;
  /** 「基準と比べる」で今回だけが決まって開いたとき true。先に基準を選ぶ窓を開き、開いたら false に戻してもらう */
  autoPickBase: boolean;
  onAutoPickHandled: () => void;
  onGoLibrary: () => void;
  onGoLoad: () => void;
}

type Role = 'base' | 'current';
const ROLES: readonly Role[] = ['base', 'current'];
const roleName = (role: Role): string => (role === 'base' ? ja.compare.base : ja.compare.current);

/** 読み込んだ 2 件。どの 2 件を読んだ結果かを一緒に持つ（選び直した直後に前の結果を出さないため） */
interface Loaded {
  pair: ComparePair;
  base: OpenedRecord | null;
  current: OpenedRecord | null;
}

/** 人物の大きさがこの割合を超えて違えば、カメラの位置が違うとみなして案内する */
const SIZE_NOTICE_RATIO = 0.05;

/** 記録の撃発の瞬間の姿勢 */
function poseOf(opened: OpenedRecord): PoseSide {
  const { record } = opened;
  const shot = shotMarkOf(record.marks);
  const frames = record.analysis.frames;
  return {
    landmarks: shot ? (frames[frameIndexAt(frames, shot.timeSec)]?.landmarks ?? null) : null,
    size: { width: record.analysis.width, height: record.analysis.height },
    tiltDeg: tiltDegOfRecord(record),
    handedness: record.meta.handedness,
  };
}

/** 比較画面：基準と今回の 2 件の撃発の瞬間を重ね、角度の差を表で示す */
export function CompareScreen(props: Props) {
  const { shooters, pair, onPairChange, autoPickBase, onAutoPickHandled, onGoLibrary } = props;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [missing, setMissing] = useState(false);
  /** 水平の線を引き直したら増やし、読み直す */
  const [version, setVersion] = useState(0);
  // 「基準と比べる」で今回だけが決まった状態で開いたときは、先に基準を選んでもらう
  const [picking, setPicking] = useState<Role | null>(
    autoPickBase && pair.baseId === null && pair.currentId !== null ? 'base' : null,
  );
  useEffect(() => {
    if (autoPickBase) onAutoPickHandled();
  }, [autoPickBase, onAutoPickHandled]);
  const [leveling, setLeveling] = useState<Role | null>(null);
  const [layout, setLayout] = useState<'overlay' | 'side'>('overlay');
  const [align, setAlign] = useState<AlignMode>('normalized');

  // 射手の名前や利き手が直されたときも読み直す（角度は利き手から計算し直す）
  useEffect(() => {
    let alive = true;
    const open = (id: number | null) => (id === null ? Promise.resolve(null) : openRecord(id));
    void Promise.all([open(pair.baseId), open(pair.currentId)]).then(
      ([base, current]) => {
        if (!alive) return;
        setLoaded({ pair, base, current });
        // 選んでいた記録が削除されたなどで開けなければ、選び直しの状態に戻す
        const lostBase = pair.baseId !== null && base === null;
        const lostCurrent = pair.currentId !== null && current === null;
        if (lostBase || lostCurrent) {
          setMissing(true);
          onPairChange({
            baseId: lostBase ? null : pair.baseId,
            currentId: lostCurrent ? null : pair.currentId,
          });
        }
      },
      () => {
        if (alive) setLoaded({ pair, base: null, current: null });
      },
    );
    return () => {
      alive = false;
    };
  }, [pair, shooters, version, onPairChange]);

  const ready = loaded !== null && loaded.pair === pair;
  const base = ready ? loaded.base : null;
  const current = ready ? loaded.current : null;

  const view = useMemo(() => {
    if (!base || !current) return null;
    const basePose = poseOf(base);
    const currentPose = poseOf(current);
    const baseMetrics = shotMetricsOfRecord(base.record)?.values ?? null;
    const currentMetrics = shotMetricsOfRecord(current.record)?.values ?? null;
    return {
      basePose,
      currentPose,
      normalizable: canNormalize(basePose, currentPose),
      rawAvailable: sameAspect(basePose.size, currentPose.size),
      diffs: baseMetrics && currentMetrics ? compareMetrics(baseMetrics, currentMetrics) : null,
      side: sideBySideViews(basePose, currentPose),
    };
  }, [base, current]);

  const choose = (role: Role, id: number) => {
    setMissing(false);
    setPicking(null);
    onPairChange(role === 'base' ? { ...pair, baseId: id } : { ...pair, currentId: id });
  };
  const saveLevel = async (role: Role, line: LevelLine | null) => {
    const target = role === 'base' ? base : current;
    if (!target) return;
    await setRecordLevel(target.row.id, line);
    setLeveling(null);
    setVersion((v) => v + 1);
  };

  const slot = (role: Role) => {
    const opened = role === 'base' ? base : current;
    const date = opened ? parseLocalDateTime(opened.row.shotAt) : null;
    return (
      <div className="pair-slot" data-testid={`pair-${role}`} data-record-id={opened?.row.id ?? ''}>
        {opened ? (
          <StoredImg image={opened.row.thumb} className="thumb small" alt="" />
        ) : (
          <span className="thumb small" />
        )}
        <div className="grow">
          <div className="pair-role">
            <span className={`skeleton-key ${role}`} aria-hidden="true" />
            {roleName(role)}
            {opened?.row.favorite && <span className="fav-on"> ★</span>}
          </div>
          {opened ? (
            <>
              <div className="pair-date num" data-testid={`pair-${role}-date`}>
                {date ? ja.record.dateTime(date) : opened.row.shotAt}
              </div>
              <div className="lib-line2">
                {ja.record.summary(
                  null,
                  opened.shooter.name,
                  opened.row.score === null ? null : formatScore(opened.row.score),
                )}
              </div>
            </>
          ) : (
            <div className="muted">{ja.compare.notChosen}</div>
          )}
        </div>
        <button data-testid={`pick-${role}`} onClick={() => setPicking(role)}>
          {opened ? ja.compare.change : ja.compare.choose}
        </button>
      </div>
    );
  };

  const levelTarget = leveling === 'base' ? base : leveling === 'current' ? current : null;
  const levelPose = levelTarget ? poseOf(levelTarget) : null;
  const levelPersonX = levelPose?.landmarks
    ? (bodyAnchor(levelPose.landmarks, levelPose.size)?.hipCenter.x ?? null)
    : null;
  const dialogs = (
    <>
      {picking && (
        <RecordPicker
          key={picking}
          role={picking}
          shooters={shooters}
          selectedId={picking === 'base' ? pair.baseId : pair.currentId}
          excludeId={picking === 'base' ? pair.currentId : pair.baseId}
          initialShooterId={
            // 射手が 1 人なら絞り込みの欄を出さないので、初期値も付けない
            shooters.length >= 2
              ? ((picking === 'base' ? current : base)?.row.shooterId ?? null)
              : null
          }
          onPick={(id) => choose(picking, id)}
          onCancel={() => setPicking(null)}
          onGoLibrary={onGoLibrary}
          onGoLoad={props.onGoLoad}
        />
      )}
      {leveling && levelTarget && (
        <LevelEditor
          image={levelTarget.still}
          size={{
            width: levelTarget.record.analysis.width,
            height: levelTarget.record.analysis.height,
          }}
          initial={levelTarget.record.level}
          personX={levelPersonX}
          onSave={(line) => saveLevel(leveling, line)}
          onCancel={() => setLeveling(null)}
        />
      )}
    </>
  );

  if (!ready) {
    return (
      <section data-testid="compare">
        <h2>{ja.compare.title}</h2>
        <p className="muted">{ja.compare.loading}</p>
      </section>
    );
  }

  if (!base && !current) {
    return (
      <section data-testid="compare">
        <h2>{ja.compare.title}</h2>
        {missing && (
          <div className="notice err" data-testid="compare-missing">
            <strong>{ja.compare.notFound}</strong>
          </div>
        )}
        <p>{ja.compare.intro}</p>
        <button
          className="primary full"
          data-testid="compare-start"
          onClick={() => setPicking('base')}
        >
          {ja.compare.chooseBase}
        </button>
        {dialogs}
      </section>
    );
  }

  // 位置と大きさを揃えられないときは「撮ったまま」で重ねる。それも無理（縦横比が違う）なら重ねない
  const mode: AlignMode = view && !view.normalizable ? 'raw' : align;
  const cannotOverlay = view !== null && !view.normalizable && !view.rawAvailable;
  const overlay = view ? overlayLayout(view.basePose, view.currentPose, mode) : null;
  const noLevel = ROLES.filter((role) => (role === 'base' ? base : current)?.record.level === null);
  const sizeGap = overlay?.sizeRatio ? Math.abs(overlay.sizeRatio - 1) : 0;

  return (
    <section data-testid="compare">
      <h2>{ja.compare.title}</h2>
      {missing && (
        <div className="notice err" data-testid="compare-missing">
          <strong>{ja.compare.notFound}</strong>
        </div>
      )}
      <div className="pair">
        {slot('base')}
        {slot('current')}
      </div>

      {(!base || !current) && (
        <button
          className="primary full"
          data-testid="compare-choose-rest"
          onClick={() => setPicking(base ? 'current' : 'base')}
        >
          {base ? ja.compare.chooseCurrent : ja.compare.chooseBase}
        </button>
      )}

      {base && current && view && overlay && (
        <>
          {noLevel.length > 0 && (
            <div className="notice err" data-testid="compare-no-level">
              <strong>
                {noLevel.length === 2
                  ? ja.compare.noLevelBoth
                  : ja.compare.noLevelOne(roleName(noLevel[0]!))}
              </strong>
              <p className="small">{ja.compare.noLevelBody}</p>
              <div className="stack">
                {noLevel.map((role) => (
                  <button
                    key={role}
                    className="full"
                    data-testid={`compare-level-${role}`}
                    onClick={() => setLeveling(role)}
                  >
                    {ja.compare.drawLevel(roleName(role))}
                  </button>
                ))}
              </div>
            </div>
          )}
          {base.shooter.handedness !== current.shooter.handedness && (
            <div className="notice" data-testid="compare-handedness">
              <strong>{ja.compare.handednessTitle}</strong>
              <p className="small">
                {ja.compare.handednessBody(base.shooter.name, base.shooter.handedness)}
              </p>
            </div>
          )}
          {base.record.analysis.backendId !== current.record.analysis.backendId && (
            <div className="notice" data-testid="compare-backend">
              <strong>{ja.compare.backendTitle}</strong>
              <p className="small">{ja.compare.backendBody}</p>
            </div>
          )}

          {layout === 'overlay' ? (
            <div data-testid="compare-overlay" data-align={mode}>
              <StillView
                image={current.still}
                width={view.currentPose.size.width}
                height={view.currentPose.size.height}
                landmarks={view.currentPose.landmarks}
                view={overlay.view}
                baseParts={
                  view.basePose.landmarks && !cannotOverlay
                    ? skeletonParts(
                        view.basePose.landmarks,
                        view.basePose.size,
                        overlay.baseTransform,
                      )
                    : null
                }
                alt={ja.compare.overlayAlt}
              />
              <p className="muted small photo-note">{ja.compare.photoNote}</p>
            </div>
          ) : (
            <div className="side-by-side" data-testid="compare-side">
              {ROLES.map((role) => {
                const opened = role === 'base' ? base : current;
                const pose = role === 'base' ? view.basePose : view.currentPose;
                return (
                  <div key={role}>
                    <p className="pair-role">
                      <span className={`skeleton-key ${role}`} aria-hidden="true" />
                      {roleName(role)}
                    </p>
                    <StillView
                      image={opened.still}
                      width={pose.size.width}
                      height={pose.size.height}
                      landmarks={pose.landmarks}
                      view={role === 'base' ? view.side.base : view.side.current}
                      variant={role}
                      testId={`still-${role}`}
                    />
                  </div>
                );
              })}
            </div>
          )}

          <div className="seg spaced">
            {(['overlay', 'side'] as const).map((l) => (
              <button
                key={l}
                data-testid={`layout-${l}`}
                aria-pressed={layout === l}
                onClick={() => setLayout(l)}
              >
                {l === 'overlay' ? ja.compare.layoutOverlay : ja.compare.layoutSide}
              </button>
            ))}
          </div>
          {layout === 'side' && <p className="muted small">{ja.compare.sideNote}</p>}
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
                  disabled={!view.normalizable}
                  onClick={() => setAlign('normalized')}
                >
                  {ja.compare.alignNormalized}
                </button>
                <button
                  data-testid="align-raw"
                  aria-pressed={mode === 'raw'}
                  disabled={!view.rawAvailable && view.normalizable}
                  onClick={() => setAlign('raw')}
                >
                  {ja.compare.alignRaw}
                </button>
              </div>
              {!view.normalizable && (
                <p className="muted small" data-testid="align-normalized-reason">
                  {ja.compare.normalizedUnavailable}
                </p>
              )}
              {!view.rawAvailable && (
                <p className="muted small" data-testid="align-raw-reason">
                  {ja.compare.rawUnavailable}
                </p>
              )}
              <p className="muted small">
                {mode === 'normalized' ? ja.compare.normalizedNote : ja.compare.rawNote}
                {mode === 'normalized' && noLevel.length === 0 && ja.compare.normalizedLevelNote}
              </p>
              {mode === 'raw' && view.normalizable && sizeGap > SIZE_NOTICE_RATIO && (
                <div className="notice" data-testid="compare-camera-moved">
                  <strong>{ja.compare.cameraMovedTitle}</strong>
                  <p className="small">{ja.compare.cameraMovedBody(Math.round(sizeGap * 100))}</p>
                </div>
              )}
            </>
          )}

          <h3>{ja.compare.tableTitle}</h3>
          {view.diffs ? (
            <DiffTable diffs={view.diffs} testId="diff-table" />
          ) : (
            <p className="danger small">{ja.metricTable.noPerson}</p>
          )}
        </>
      )}
      {dialogs}
    </section>
  );
}
