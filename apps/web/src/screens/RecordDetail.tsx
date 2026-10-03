import {
  clipDurationSec,
  clipOf,
  frameIndexAt,
  parseLocalDateTime,
  shotMarkOf,
} from '@pistol-kamae/engine';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { forgetEnvelope } from '../audio/useAudioEnvelope';
import { AttachVideo } from '../components/AttachVideo';
import { ConfirmDialog, Dialog } from '../components/Dialog';
import { RecordForm } from '../components/RecordForm';
import { StillView } from '../components/StillView';
import { StoredImg } from '../components/StoredImg';
import {
  deleteRecord,
  hasRecordVideo,
  openRecord,
  setRecordFavorite,
  updateRecordFields,
  type OpenedRecord,
  type RecordFields,
} from '../db/library';
import type { ShooterRow } from '../db/schema';
import { ja } from '../i18n/ja';
import { personCrop } from '../library/crop';
import { RecordPlayer, type PlayerMode } from './RecordPlayer';

interface Props {
  recordId: number;
  /** ライブラリが表示中か（隠れたら再生を止める） */
  active: boolean;
  shooters: ShooterRow[];
  onShootersChanged: () => Promise<void>;
  /** 一覧へ戻る */
  onClose: () => void;
  /** 内容（タイトル・撃発ポイント・範囲など）が変わったとき */
  onChanged: (id: number) => void;
  onDeleted: (id: number) => void;
}

type State = { kind: 'loading' } | { kind: 'notFound' } | { kind: 'open'; opened: OpenedRecord };

/**
 * ライブラリから開いた 1 本の動画。撃発の瞬間の静止画＋骨格、情報、編集・修正・再生・削除。
 */
export function RecordDetail(props: Props) {
  const { recordId, shooters, onShootersChanged, onClose, onChanged, onDeleted } = props;
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [editing, setEditing] = useState(false);
  const [player, setPlayer] = useState<PlayerMode | null>(null);
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
    // 開けない記録（形式が壊れているなど）も、削除だけはできるようにしておく
    return (
      <section>
        {back}
        <div className="notice err" data-testid="detail-not-found">
          <strong>{ja.library.notFound}</strong>
          <p className="small">{ja.library.notFoundBody}</p>
        </div>
        <div className="gap-destructive" />
        <button
          className="danger full"
          data-testid="detail-remove"
          onClick={() => void deleteRecord(recordId).then(() => onDeleted(recordId))}
        >
          {ja.library.remove}
        </button>
      </section>
    );
  }

  if (player) {
    return (
      <RecordPlayer
        opened={opened}
        mode={player}
        active={props.active}
        backLabel={ja.library.backToDetail}
        onClose={() => setPlayer(null)}
        onChanged={(id) => {
          void reload();
          onChanged(id);
        }}
      />
    );
  }

  const { row, shooter, record, still } = opened;
  const { analysis } = record;
  const size = { width: analysis.width, height: analysis.height };
  const view = personCrop(shotLandmarks, size);
  const date = parseLocalDateTime(row.shotAt);
  const shot = shotMarkOf(record.marks)!;
  const clip = clipOf(record.clip, analysis.durationSec);
  const clipSec = clipDurationSec(record.clip, analysis.durationSec);

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
  const remove = async () => {
    setRemoveBusy(true);
    setRemoveFailed(false);
    try {
      await deleteRecord(row.id);
      forgetEnvelope(row.id);
      onDeleted(row.id);
    } catch {
      setRemoveFailed(true);
      setRemoveBusy(false);
    }
  };

  return (
    <section data-testid="record-detail" data-record-id={row.id}>
      {back}

      <StillView
        image={still}
        width={analysis.width}
        height={analysis.height}
        landmarks={shotLandmarks}
        view={view}
      />

      <div className="row nowrap">
        <h2 className="grow ellipsis" data-testid="detail-title">
          {row.title}
        </h2>
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
      <dl className="kv small">
        <dt>{ja.library.detailShooter}</dt>
        <dd data-testid="detail-shooter">
          {ja.library.shooterLine(shooter.name, shooter.handedness)}
        </dd>
        <dt>{ja.library.detailShotAt}</dt>
        <dd className="num" data-testid="detail-date">
          {date ? ja.record.dateTime(date) : row.shotAt}
        </dd>
        <dt>{ja.library.detailLength}</dt>
        <dd className="num" data-testid="detail-length">
          {ja.library.detailLengthValue(clipSec, analysis.durationSec, clip.startSec, clip.endSec)}
        </dd>
        <dt>{ja.library.detailShot}</dt>
        <dd className="num" data-testid="detail-shot">
          {ja.library.detailShotValue(shot.timeSec)}
        </dd>
        {row.memo !== '' && (
          <>
            <dt>{ja.library.detailMemo}</dt>
            <dd data-testid="detail-memo">{row.memo}</dd>
          </>
        )}
      </dl>

      <div className="stack">
        <button
          className="full"
          data-testid="detail-play"
          disabled={hasVideo !== true}
          onClick={() => setPlayer('play')}
        >
          {ja.library.play}
        </button>
        <button className="full" data-testid="detail-edit" onClick={() => setEditing(true)}>
          {ja.library.edit}
        </button>
        <button
          className="full"
          data-testid="detail-fix-shot"
          disabled={hasVideo !== true}
          onClick={() => setPlayer('shot')}
        >
          {ja.library.fixShot}
        </button>
        <button
          className="full"
          data-testid="detail-fix-clip"
          disabled={hasVideo !== true}
          onClick={() => setPlayer('clip')}
        >
          {ja.library.fixClip}
        </button>
      </div>

      {hasVideo !== null && (
        <div className="detail-row" data-testid="detail-video" data-has-video={hasVideo}>
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
          onAttached={() => {
            forgetEnvelope(row.id);
            void checkVideo();
          }}
          testId="detail-attach"
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
      <button className="danger full" data-testid="detail-remove" onClick={() => setRemoving(true)}>
        {ja.library.remove}
      </button>

      {editing && (
        <Dialog
          variant="sheet"
          title={ja.record.formEditTitle}
          onCancel={() => setEditing(false)}
          testId="edit-dialog"
        >
          <RecordForm
            mode="edit"
            shooters={shooters}
            initial={{
              title: row.title,
              shooterId: row.shooterId,
              shotAt: row.shotAt,
              memo: row.memo,
              favorite: row.favorite,
            }}
            onSubmit={saveEdit}
            onCancel={() => setEditing(false)}
            onShootersChanged={onShootersChanged}
          />
        </Dialog>
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
            <p className="small num">{row.title}</p>
          </div>
          <p className="small">{ja.library.removeBody}</p>
          {removeFailed && <p className="danger small">{ja.library.removeFailed}</p>}
        </ConfirmDialog>
      )}
    </section>
  );
}
