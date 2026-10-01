import {
  bodyAnchor,
  formatScore,
  frameIndexAt,
  hasUsableLevel,
  levelInfo,
  parseLocalDateTime,
  shotMarkOf,
  shotMetricsOfRecord,
  type LevelLine,
  type Rect,
} from '@pistol-kamae/engine';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AttachVideo } from '../components/AttachVideo';
import { ConfirmDialog } from '../components/Dialog';
import { LevelEditor } from '../components/LevelEditor';
import { MetricTable } from '../components/MetricTable';
import { RecordForm } from '../components/RecordForm';
import { Score } from '../components/Score';
import { StillView } from '../components/StillView';
import { StoredImg } from '../components/StoredImg';
import {
  deleteRecord,
  hasRecordVideo,
  openRecord,
  setRecordFavorite,
  setRecordLevel,
  updateRecordFields,
  type OpenedRecord,
  type RecordFields,
} from '../db/library';
import type { ShooterRow } from '../db/schema';
import { ja } from '../i18n/ja';
import { personCrop } from '../library/crop';

interface Props {
  recordId: number;
  shooters: ShooterRow[];
  onShootersChanged: () => Promise<void>;
  /** 一覧へ戻る */
  onClose: () => void;
  /** 内容（射手・点数・お気に入りなど）が変わったとき */
  onChanged: (id: number) => void;
  onDeleted: (id: number) => void;
  /** この記録を「今回」として、基準と比べる（比較画面へ移る） */
  onCompare: (id: number) => void;
}

type State = { kind: 'loading' } | { kind: 'notFound' } | { kind: 'open'; opened: OpenedRecord };

/**
 * ライブラリから開いた 1 件。静止画＋骨格と、撃発の瞬間の角度表。動画は保存していないので出ない。
 * 水平の線（カメラの傾きの補正）もここで引く。
 */
export function RecordDetail(props: Props) {
  const { recordId, shooters, onShootersChanged, onClose, onChanged, onDeleted, onCompare } = props;
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [fit, setFit] = useState<'person' | 'whole'>('person');
  const [editing, setEditing] = useState(false);
  const [leveling, setLeveling] = useState(false);
  /** 動画本体が保存されているか。調べ終わるまでは null */
  const [hasVideo, setHasVideo] = useState<boolean | null>(null);
  const checkVideo = useCallback(
    () =>
      hasRecordVideo(recordId).then(setHasVideo, () => {
        setHasVideo(false);
      }),
    [recordId],
  );
  useEffect(() => {
    void checkVideo();
  }, [checkVideo]);
  const [removing, setRemoving] = useState(false);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeFailed, setRemoveFailed] = useState(false);

  const reload = useCallback(
    () =>
      openRecord(recordId).then(
        (opened) => setState(opened ? { kind: 'open', opened } : { kind: 'notFound' }),
        () => setState({ kind: 'notFound' }),
      ),
    [recordId],
  );

  // 射手の名前や利き手が直されたときも読み直す（角度は利き手から計算し直す）
  useEffect(() => {
    void reload();
  }, [reload, shooters]);

  const opened = state.kind === 'open' ? state.opened : null;
  const metrics = useMemo(() => (opened ? shotMetricsOfRecord(opened.record) : null), [opened]);
  const shotLandmarks = useMemo(() => {
    if (!opened) return null;
    const shot = shotMarkOf(opened.record.marks);
    const frames = opened.record.analysis.frames;
    return shot ? (frames[frameIndexAt(frames, shot.timeSec)]?.landmarks ?? null) : null;
  }, [opened]);

  const back = (
    <div className="row">
      <button data-testid="detail-back" onClick={onClose}>
        {ja.library.back}
      </button>
    </div>
  );

  if (state.kind === 'loading') {
    return (
      <section>
        {back}
        <p className="muted">{ja.library.loading}</p>
      </section>
    );
  }
  if (!opened) {
    return (
      <section>
        {back}
        <div className="notice err" data-testid="detail-not-found">
          <strong>{ja.library.notFound}</strong>
        </div>
      </section>
    );
  }

  const { row, shooter, record, still } = opened;
  const { analysis } = record;
  const size = { width: analysis.width, height: analysis.height };
  const whole: Rect = { x: 0, y: 0, ...size };
  const view = fit === 'person' ? personCrop(shotLandmarks, size) : whole;
  const date = parseLocalDateTime(row.shotAt);
  const summary = ja.record.summary(
    date,
    shooter.name,
    row.score === null ? null : formatScore(row.score),
  );

  const toggleFavorite = async () => {
    await setRecordFavorite(row.id, !row.favorite);
    await reload();
    onChanged(row.id);
  };
  const saveEdit = async (fields: RecordFields) => {
    await updateRecordFields(row.id, fields);
    await reload();
    setEditing(false);
    onChanged(row.id);
  };
  const saveLevel = async (line: LevelLine | null) => {
    await setRecordLevel(row.id, line);
    await reload();
    setLeveling(false);
    onChanged(row.id);
  };
  // 線はあるが、今の基準（長さ・傾き）に合わず補正に使っていないとき
  const unusableLevel = record.level !== null && !hasUsableLevel(record);
  const tiltText = hasUsableLevel(record)
    ? ja.level.tilt(levelInfo(record.level!)?.tiltDeg ?? 0)
    : null;
  const remove = async () => {
    setRemoveBusy(true);
    setRemoveFailed(false);
    try {
      await deleteRecord(row.id);
      onDeleted(row.id);
    } catch {
      setRemoveFailed(true);
      setRemoveBusy(false);
    }
  };

  return (
    <section data-testid="record-detail" data-record-id={row.id}>
      <div className="row nowrap">
        <button data-testid="detail-back" onClick={onClose}>
          {ja.library.back}
        </button>
        <span className="grow" />
        <button
          className={row.favorite ? 'icon fav-on' : 'icon fav-off'}
          data-testid="detail-favorite"
          aria-pressed={row.favorite}
          aria-label={row.favorite ? ja.library.removeFavorite : ja.library.addFavorite}
          onClick={() => void toggleFavorite()}
        >
          {row.favorite ? '★' : '☆'}
        </button>
      </div>

      <div className="detail-head">
        <h2 data-testid="detail-date">{date ? ja.record.dateTime(date) : row.shotAt}</h2>
        <Score value={row.score} big />
      </div>
      <p className="small" data-testid="detail-shooter">
        {ja.library.shooterLine(shooter.name, shooter.handedness)}
      </p>
      {row.memo !== '' && (
        <p className="small memo" data-testid="detail-memo">
          {ja.library.memo(row.memo)}
        </p>
      )}

      <StillView
        image={still}
        width={analysis.width}
        height={analysis.height}
        landmarks={shotLandmarks}
        view={view}
      />
      <div className="seg spaced">
        {(['person', 'whole'] as const).map((f) => (
          <button
            key={f}
            data-testid={`fit-${f}`}
            aria-pressed={fit === f}
            onClick={() => setFit(f)}
          >
            {f === 'person' ? ja.library.fitPerson : ja.library.fitWhole}
          </button>
        ))}
      </div>
      <p className="muted small">{ja.player.legend}</p>

      <div className="level-row" data-testid="detail-level" data-has-level={record.level !== null}>
        <span className="grow small">
          <strong>{tiltText === null ? ja.level.rowNone : ja.level.rowSet}</strong>
          <br />
          <span className="muted num">
            {unusableLevel
              ? ja.level.rowUnusableHint
              : tiltText === null
                ? ja.level.rowNoneHint
                : ja.level.rowSetHint(tiltText)}
          </span>
        </span>
        <button data-testid="detail-level-open" onClick={() => setLeveling(true)}>
          {record.level === null ? ja.level.draw : ja.level.redraw}
        </button>
      </div>

      {hasVideo !== null && (
        <div className="level-row" data-testid="detail-video" data-has-video={hasVideo}>
          <span className="grow small">
            <strong>{hasVideo ? ja.video.rowSaved : ja.video.rowNone}</strong>
            {!hasVideo && (
              <>
                <br />
                <span className="muted">{ja.video.rowNoneHint}</span>
              </>
            )}
          </span>
        </div>
      )}
      {hasVideo === false && (
        <AttachVideo
          recordId={row.id}
          analysis={analysis}
          onAttached={() => void checkVideo()}
          testId="detail-attach"
        />
      )}

      <button
        className="primary full"
        data-testid="detail-compare"
        onClick={() => onCompare(row.id)}
      >
        {ja.library.compare}
      </button>
      <div className="row">
        <button data-testid="detail-edit" onClick={() => setEditing(true)}>
          {ja.library.edit}
        </button>
      </div>

      <h3>{ja.mark.tableTitle}</h3>
      {metrics && (
        <MetricTable
          metrics={metrics}
          testId="detail-table"
          {...(tiltText === null ? {} : { note: ja.level.tableNote(tiltText) })}
        />
      )}

      <p className="muted small" data-testid="detail-info">
        {ja.library.info(
          analysis.width,
          analysis.height,
          analysis.fps,
          analysis.frames.length,
          analysis.backendId,
        )}
      </p>

      <div className="gap-destructive" />
      <button className="danger" data-testid="detail-remove" onClick={() => setRemoving(true)}>
        {ja.library.remove}
      </button>

      {editing && (
        <RecordForm
          mode="edit"
          shooters={shooters}
          initial={{
            shooterId: row.shooterId,
            shotAt: row.shotAt,
            score: row.score,
            memo: row.memo,
            favorite: row.favorite,
          }}
          onSubmit={saveEdit}
          onCancel={() => setEditing(false)}
          onShootersChanged={onShootersChanged}
        />
      )}

      {leveling && (
        <LevelEditor
          image={still}
          size={size}
          initial={record.level}
          personX={shotLandmarks ? (bodyAnchor(shotLandmarks, size)?.hipCenter.x ?? null) : null}
          onSave={saveLevel}
          onCancel={() => setLeveling(false)}
        />
      )}

      {removing && (
        <ConfirmDialog
          title={ja.library.removeTitle}
          confirmLabel={ja.library.removeConfirm}
          destructive
          busy={removeBusy}
          onConfirm={() => void remove()}
          onCancel={() => setRemoving(false)}
          testId="remove-dialog"
        >
          <div className="dialog-target">
            <StoredImg image={row.thumb} className="thumb" alt="" />
            <p className="small num">{summary}</p>
          </div>
          <p className="small">{ja.library.removeBody}</p>
          {removeFailed && <p className="danger small">{ja.library.removeFailed}</p>}
        </ConfirmDialog>
      )}
    </section>
  );
}
