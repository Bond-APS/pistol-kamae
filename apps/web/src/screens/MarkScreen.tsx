import {
  addCustomMark,
  formatScore,
  frameIndexAt,
  hasCustomMarkLabel,
  metricsAtTime,
  nextMarkId,
  normalizeMarkLabel,
  parseLocalDateTime,
  removeMark,
  setShotMark,
  shotMarkOf,
  toLocalDateTime,
  type Mark,
  type RecordAnalysis,
} from '@pistol-kamae/engine';
import { useMemo, useState, type RefObject } from 'react';
import type { AnalysisResult } from '../analysis/runAnalysis';
import { MetricTable } from '../components/MetricTable';
import { RecordForm } from '../components/RecordForm';
import { addRecord, overwriteRecordMarks, type RecordFields } from '../db/library';
import type { ShooterRow } from '../db/schema';
import { ja } from '../i18n/ja';
import { isChangedAfterSave, marksKeyOf, type SavedState } from '../library/savedState';
import { captureShotImages } from '../video/capture';
import { showFrame } from '../video/showFrame';

interface Props {
  videoRef: RefObject<HTMLVideoElement | null>;
  result: AnalysisResult | null;
  /** プレイヤーが表示中のフレーム番号 */
  frameIndex: number;
  shooters: ShooterRow[];
  /** 読込画面で選んだ射手。利き手はここから決まる */
  shooter: ShooterRow | null;
  marks: Mark[];
  onMarksChange: (marks: Mark[]) => void;
  /** 動画ファイルの更新日時（撮影日時の初期値） */
  fileDate: Date | null;
  saved: SavedState | null;
  onSaved: (saved: SavedState) => void;
  onShootersChanged: () => Promise<void>;
  onGoLoad: () => void;
  onGoLibrary: () => void;
}

const analysisOf = (r: AnalysisResult): RecordAnalysis => ({
  backendId: r.backendId,
  width: r.width,
  height: r.height,
  fps: r.fps,
  durationSec: r.durationSec,
  frames: r.frames,
});

export function MarkScreen(props: Props) {
  const { videoRef, result, frameIndex, shooters, shooter, marks, onMarksChange, saved } = props;
  const [labelText, setLabelText] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [overwriting, setOverwriting] = useState(false);
  const [overwriteFailed, setOverwriteFailed] = useState(false);

  const handedness = shooter?.handedness ?? 'right';
  const shot = shotMarkOf(marks);
  const shotMetrics = useMemo(
    () =>
      result && shot
        ? metricsAtTime(
            {
              frames: result.frames,
              handedness,
              imageWidth: result.width,
              imageHeight: result.height,
            },
            shot.timeSec,
          )
        : null,
    [result, shot, handedness],
  );

  if (!result) {
    return (
      <section>
        <h2>{ja.mark.title}</h2>
        <p>{ja.mark.noResult}</p>
        <button data-testid="mark-go-load" onClick={props.onGoLoad}>
          {ja.common.goLoad}
        </button>
      </section>
    );
  }

  const current = result.frames[frameIndex];
  const label = normalizeMarkLabel(labelText);
  // 同じ名前は 1 つまで。撃発マークの表示名とも重ならないようにする
  const duplicate =
    label !== null && (label === ja.mark.shotName || hasCustomMarkLabel(marks, label));
  const changed = isChangedAfterSave(marks, saved);

  const markShot = () => {
    if (current) onMarksChange(setShotMark(marks, current.timeSec));
  };
  const addCustom = () => {
    if (!current || label === null || duplicate) return;
    onMarksChange(addCustomMark(marks, { id: nextMarkId(marks), label, timeSec: current.timeSec }));
    setLabelText('');
  };
  const jumpTo = (mark: Mark) => {
    const video = videoRef.current;
    if (video) showFrame(video, result, frameIndexAt(result.frames, mark.timeSec));
  };

  /** 撃発フレームの静止画を作る。動画は撃発フレームへ移動する */
  const captureImages = () => {
    const video = videoRef.current;
    if (!video || !shot) throw new Error('nothing to save');
    return captureShotImages(video, result, shot.timeSec);
  };
  const saveNew = async (fields: RecordFields) => {
    const images = await captureImages();
    const recordId = await addRecord(fields, analysisOf(result), marks, images);
    props.onSaved({ recordId, marksKey: marksKeyOf(marks), fields });
    setFormOpen(false);
  };
  /** 保存後にマークを変えたとき。同じ 1 件のマークと静止画を差し替える（件数は増えない） */
  const overwrite = async () => {
    if (!saved || overwriting) return;
    setOverwriting(true);
    setOverwriteFailed(false);
    try {
      const images = await captureImages();
      await overwriteRecordMarks(saved.recordId, marks, images);
      props.onSaved({ ...saved, marksKey: marksKeyOf(marks) });
    } catch {
      setOverwriteFailed(true);
    }
    setOverwriting(false);
  };

  const savedShooter = saved ? shooters.find((s) => s.id === saved.fields.shooterId) : undefined;
  const savedSummary = saved
    ? ja.record.summary(
        parseLocalDateTime(saved.fields.shotAt),
        savedShooter?.name ?? '',
        saved.fields.score === null ? null : formatScore(saved.fields.score),
      )
    : '';

  return (
    <section>
      {/* 主ボタンは画面に 1 つ。撃発マークが付いたら、主ボタンの役は保存に譲る */}
      <button
        className={shot ? 'full' : 'primary full'}
        data-testid="mark-shot"
        disabled={!current}
        onClick={markShot}
      >
        {shot ? ja.mark.resetShot : ja.mark.setShot}
      </button>
      <div className="gap-action" />

      <div data-testid="save-block" data-saved-id={saved?.recordId ?? ''}>
        {saved && !changed ? (
          <div className="notice ok" data-testid="save-done">
            <strong>{ja.save.savedTitle}</strong>
            <p className="small num" data-testid="save-summary">
              {savedSummary}
            </p>
            <div className="stack">
              <button className="primary full" data-testid="save-next" onClick={props.onGoLoad}>
                {ja.save.nextVideo}
              </button>
              <button className="full" data-testid="save-view" onClick={props.onGoLibrary}>
                {ja.save.viewLibrary}
              </button>
            </div>
          </div>
        ) : saved ? (
          <>
            <button
              className={shot ? 'primary full' : 'full'}
              data-testid="save-overwrite"
              disabled={!shot || overwriting}
              onClick={() => void overwrite()}
            >
              {overwriting ? ja.save.saving : ja.save.overwrite}
            </button>
            <p className="small" data-testid="save-status">
              <span className="status-dot">●</span> {ja.save.changed}
            </p>
          </>
        ) : (
          <>
            <button
              className={shot ? 'primary full' : 'full'}
              data-testid="save-open"
              disabled={!shot || !shooter}
              onClick={() => setFormOpen(true)}
            >
              {ja.save.save}
            </button>
            {shot && shotMetrics && (
              <p className="small" data-testid="save-status">
                <span className="status-dot">●</span> {ja.save.unsaved(shotMetrics.frameIndex)}
              </p>
            )}
          </>
        )}
        {!shot && (
          <p className="muted small" data-testid="save-need-shot">
            {ja.save.needShot}
          </p>
        )}
        {overwriteFailed && (
          <div className="notice err" data-testid="save-failed">
            <strong>{ja.save.failedTitle}</strong>
            <p className="small">{ja.save.failedBody}</p>
          </div>
        )}
      </div>
      {!shot && <p className="muted small">{ja.mark.intro}</p>}

      <h3>{ja.mark.customTitle}</h3>
      <div className="row">
        <label className="field grow">
          <span>{ja.mark.customLabel}</span>
          <input
            type="text"
            data-testid="custom-label"
            className={duplicate ? 'input-error' : undefined}
            value={labelText}
            placeholder={ja.mark.customPlaceholder}
            maxLength={30}
            onChange={(e) => setLabelText(e.target.value)}
          />
        </label>
        <button
          data-testid="add-custom"
          disabled={!current || label === null || duplicate}
          onClick={addCustom}
        >
          {ja.mark.addCustom}
        </button>
      </div>
      {duplicate && (
        <p className="danger small" data-testid="custom-duplicate">
          {ja.mark.customDuplicate}
        </p>
      )}

      <h3>{ja.mark.listTitle}</h3>
      {marks.length === 0 ? (
        <p className="muted small">{ja.mark.listEmpty}</p>
      ) : (
        <ul className="mark-list" data-testid="mark-list">
          {marks.map((m) => {
            const index = frameIndexAt(result.frames, m.timeSec);
            return (
              <li
                key={m.id}
                data-testid="mark-item"
                data-mark-id={m.id}
                data-mark-kind={m.kind}
                data-frame-index={index}
              >
                <button
                  className={index === frameIndex ? 'mark-jump active' : 'mark-jump'}
                  data-testid="mark-jump"
                  onClick={() => jumpTo(m)}
                >
                  <strong>{m.kind === 'shot' ? ja.mark.shotName : m.label}</strong>
                  <span className="small">{ja.mark.position(index, m.timeSec)}</span>
                </button>
                <button
                  className="danger"
                  data-testid="mark-remove"
                  aria-label={ja.mark.removeAria(m.kind === 'shot' ? ja.mark.shotName : m.label)}
                  onClick={() => onMarksChange(removeMark(marks, m.id))}
                >
                  {ja.mark.remove}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <h3>{ja.mark.tableTitle}</h3>
      {!shotMetrics ? (
        <p className="muted small" data-testid="shot-table-empty">
          {ja.mark.tableNoShot}
        </p>
      ) : (
        <>
          <p className="muted small">
            {ja.mark.tableFrame(shotMetrics.frameIndex, shotMetrics.timeSec)}
          </p>
          <MetricTable metrics={shotMetrics} testId="shot-table" />
        </>
      )}

      {formOpen && shooter && (
        <RecordForm
          mode="save"
          shooters={shooters}
          initial={{
            shooterId: shooter.id,
            shotAt: toLocalDateTime(props.fileDate ?? new Date()),
            score: null,
            memo: '',
            favorite: false,
          }}
          onSubmit={saveNew}
          onCancel={() => setFormOpen(false)}
          onShootersChanged={props.onShootersChanged}
        />
      )}
    </section>
  );
}
