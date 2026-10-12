import {
  clipDurationSec,
  clipOf,
  frameIndexAt,
  parseLocalDateTime,
  shotMarkOf,
  toLocalDateTime,
} from '@pistol-kamae/engine';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { forgetEnvelope } from '../audio/useAudioEnvelope';
import { AttachVideo } from '../components/AttachVideo';
import { ConfirmDialog, Dialog } from '../components/Dialog';
import { ExportStatusLine } from '../components/ExportStatusLine';
import { RecordForm } from '../components/RecordForm';
import { StillView } from '../components/StillView';
import { StoredImg } from '../components/StoredImg';
import {
  deleteRecord,
  getRecordAudio,
  getRecordVideo,
  hasRecordVideo,
  openRecordResult,
  setRecordFavorite,
  updateRecordFields,
  type OpenedRecord,
  type RecordFields,
} from '../db/library';
import type { RecordRow, ShooterRow } from '../db/schema';
import { buildCsv } from '../export/csv';
import { recordFileName } from '../export/filename';
import { buildExportBlob } from '../export/json';
import { useExport } from '../export/useExport';
import { ja } from '../i18n/ja';
import { useNav, useNavListener } from '../navigation/useNav';
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

type State =
  | { kind: 'loading' }
  | { kind: 'open'; opened: OpenedRecord }
  /** 見出しの行がない（削除済みなど） */
  | { kind: 'missing' }
  /** 中身が壊れている・形式が合わない（削除はできる） */
  | { kind: 'invalid'; row: RecordRow }
  /** 読み出しに失敗した（一時的な問題かもしれないので、削除は勧めない） */
  | { kind: 'readFailed' };

/**
 * ライブラリから開いた 1 本の動画。撃発の瞬間の静止画＋骨格、情報、編集・修正・再生・削除。
 */
export function RecordDetail(props: Props) {
  const { recordId, shooters, onShootersChanged, onClose, onChanged, onDeleted } = props;
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [editing, setEditing] = useState(false);
  const [player, setPlayer] = useState<PlayerMode | null>(null);
  // 「動画を再生」「撃発ポイントの修正」「切り抜き範囲の修正」は履歴を 1 つ積み、ブラウザの「戻る」で詳細に戻る
  const nav = useNav();
  const openPlayer = (mode: PlayerMode) => {
    setPlayer(mode);
    nav.push({ view: 'library', detail: recordId, player: mode });
  };
  const closePlayer = () => nav.back({ view: 'library', detail: recordId });
  useNavListener((entry) => {
    if (entry.view === 'library' && entry.detail === recordId) setPlayer(entry.player ?? null);
  });
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
  /** 「JSON で書き出す」で、動画本体を含めるかを選ぶ窓 */
  const [jsonChoice, setJsonChoice] = useState(false);
  const exporter = useExport();
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeFailed, setRemoveFailed] = useState(false);

  const reload = useCallback(
    () =>
      openRecordResult(recordId).then(
        (result) => {
          if (result.kind === 'open') setState({ kind: 'open', opened: result.opened });
          else if (result.kind === 'missing') setState({ kind: 'missing' });
          else setState({ kind: 'invalid', row: result.row });
        },
        () => setState({ kind: 'readFailed' }),
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
  /** 削除の対象（開けた記録か、形が合わない記録の見出し）。読み出しの失敗では削除を勧めない */
  const removeTarget: RecordRow | null =
    state.kind === 'open' ? state.opened.row : state.kind === 'invalid' ? state.row : null;
  const remove = async () => {
    if (!removeTarget) return;
    setRemoveBusy(true);
    setRemoveFailed(false);
    try {
      await deleteRecord(removeTarget.id);
      forgetEnvelope(removeTarget.id);
      onDeleted(removeTarget.id);
    } catch {
      setRemoveFailed(true);
      setRemoveBusy(false);
    }
  };
  // 削除の確認の窓（開けた記録も、形が合わない記録も同じ窓を通す）
  const removeDialog = removing && removeTarget && (
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
        <StoredImg image={removeTarget.thumb} className="thumb" alt="" />
        <p className="small num">{removeTarget.title}</p>
      </div>
      <p className="small">{ja.library.removeBody}</p>
      {removeFailed && <p className="danger small">{ja.library.removeFailed}</p>}
    </ConfirmDialog>
  );

  if (state.kind === 'readFailed') {
    // 一時的な失敗かもしれないので、読み直しだけを勧める（削除のボタンは出さない）
    return (
      <section>
        {back}
        <div className="notice err" data-testid="detail-read-failed">
          <strong>{ja.library.readFailed}</strong>
          <p className="small">{ja.library.readFailedBody}</p>
        </div>
        <div className="row">
          <button
            data-testid="detail-retry"
            onClick={() => {
              setState({ kind: 'loading' });
              void reload();
            }}
          >
            {ja.library.retry}
          </button>
        </div>
      </section>
    );
  }
  if (state.kind === 'missing') {
    return (
      <section>
        {back}
        <div className="notice err" data-testid="detail-missing">
          <strong>{ja.library.missing}</strong>
        </div>
      </section>
    );
  }
  if (!opened) {
    // 形が合わない記録（中身が壊れている、古すぎるなど）は、削除だけはできるようにしておく。削除は通常と同じ確認の窓を通す
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
          onClick={() => setRemoving(true)}
        >
          {ja.library.remove}
        </button>
        {removeDialog}
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
        onClose={closePlayer}
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
  /** JSON で書き出す。includeVideo なら動画本体も入れる（既定は記録だけ） */
  const exportJson = (includeVideo: boolean) => {
    setJsonChoice(false);
    void exporter.run(async () => {
      const audio = await getRecordAudio(row.id);
      const video = includeVideo ? await getRecordVideo(row.id) : null;
      const blob = buildExportBlob(
        [{ record, still, thumb: row.thumb, audio, video }],
        toLocalDateTime(new Date()),
      );
      return { blob, name: recordFileName(shooter.name, row.shotAt, 'json') };
    });
  };
  const exportCsv = () =>
    void exporter.run(async () => ({
      blob: new Blob([buildCsv(record)], { type: 'text/csv' }),
      name: recordFileName(shooter.name, row.shotAt, 'csv'),
    }));
  const exporting = exporter.status === 'busy';
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
          onClick={() => openPlayer('play')}
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
          onClick={() => openPlayer('shot')}
        >
          {ja.library.fixShot}
        </button>
        <button
          className="full"
          data-testid="detail-fix-clip"
          disabled={hasVideo !== true}
          onClick={() => openPlayer('clip')}
        >
          {ja.library.fixClip}
        </button>
        <button
          className="full"
          data-testid="detail-export-json"
          // 動画の有無を調べ終えるまで待つ（窓を出すかどうかが決まらないため）
          disabled={exporting || hasVideo === null}
          onClick={() => (hasVideo ? setJsonChoice(true) : exportJson(false))}
        >
          {ja.export.json}
        </button>
        <button
          className="full"
          data-testid="detail-export-csv"
          disabled={exporting}
          onClick={exportCsv}
        >
          {ja.export.csv}
        </button>
        <ExportStatusLine
          status={exporter.status}
          onShare={exporter.share}
          testId="detail-export-status"
        />
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

      {jsonChoice && (
        <Dialog
          variant="confirm"
          title={ja.export.jsonChoiceTitle}
          onCancel={() => setJsonChoice(false)}
          testId="json-choice-dialog"
        >
          <p className="small">{ja.export.jsonChoiceBody}</p>
          <div className="stack">
            <button
              className="primary full"
              data-testid="json-record-only"
              onClick={() => exportJson(false)}
            >
              {ja.export.jsonRecordOnly}
            </button>
            <button className="full" data-testid="json-with-video" onClick={() => exportJson(true)}>
              {ja.export.jsonWithVideo}
            </button>
            <button
              className="full"
              data-testid="confirm-cancel"
              onClick={() => setJsonChoice(false)}
            >
              {ja.common.cancel}
            </button>
          </div>
        </Dialog>
      )}

      {removeDialog}
    </section>
  );
}
