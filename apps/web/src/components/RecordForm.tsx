import { formatScore, normalizeLocalDateTime, parseScore } from '@pistol-kamae/engine';
import { useState } from 'react';
import type { RecordFields } from '../db/library';
import type { ShooterRow } from '../db/schema';
import { ja } from '../i18n/ja';
import { Dialog } from './Dialog';
import { ShooterDialog } from './ShooterDialog';

interface Props {
  /** save：マーク画面からの保存、edit：ライブラリでの編集 */
  mode: 'save' | 'edit';
  shooters: ShooterRow[];
  initial: RecordFields;
  /** 保存する。失敗したら例外を投げる（入力を残したまま、エラーを表示する） */
  onSubmit: (fields: RecordFields) => Promise<void>;
  onCancel: () => void;
  /** このフォームの中で射手を登録したとき（射手の一覧を読み直してもらう） */
  onShootersChanged: () => Promise<void>;
}

/**
 * 記録に付ける情報（射手・点数・お気に入り・撮影日時・メモ）の入力。
 * 保存時と編集時で同じ形を使う。利き手は射手に付いているので、ここでは選ばない。
 */
export function RecordForm(props: Props) {
  const { mode, shooters, initial, onSubmit, onCancel, onShootersChanged } = props;
  const [shooterId, setShooterId] = useState(initial.shooterId);
  const [scoreText, setScoreText] = useState(
    initial.score === null ? '' : formatScore(initial.score),
  );
  const [favorite, setFavorite] = useState(initial.favorite);
  const [shotAtText, setShotAtText] = useState(initial.shotAt);
  const [memo, setMemo] = useState(initial.memo);
  const [addingShooter, setAddingShooter] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const score = parseScore(scoreText);
  const shotAt = normalizeLocalDateTime(shotAtText);
  const canSubmit = score.ok && shotAt !== null && !busy;

  const submit = async () => {
    if (!score.ok || shotAt === null || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await onSubmit({ shooterId, shotAt, score: score.value, memo: memo.trim(), favorite });
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  return (
    <Dialog
      variant="sheet"
      title={mode === 'save' ? ja.record.formSaveTitle : ja.record.formEditTitle}
      onCancel={() => {
        if (!busy) onCancel();
      }}
      testId="record-form"
    >
      <div className="field">
        <span>{ja.shooter.label}</span>
        <div className="chips">
          {shooters.map((s) => (
            <button
              key={s.id}
              type="button"
              className="chip"
              data-testid="form-shooter"
              data-shooter-id={s.id}
              aria-pressed={s.id === shooterId}
              onClick={() => setShooterId(s.id)}
            >
              {ja.shooter.chip(s.name, s.handedness)}
            </button>
          ))}
          <button
            type="button"
            className="chip"
            data-testid="form-add-shooter"
            onClick={() => setAddingShooter(true)}
          >
            {ja.shooter.addChip}
          </button>
        </div>
      </div>

      <div className="row nowrap align-end">
        <label className="field grow tight">
          <span>{ja.record.score}</span>
          <input
            type="text"
            inputMode="decimal"
            data-testid="form-score"
            className={score.ok ? undefined : 'input-error'}
            value={scoreText}
            autoComplete="off"
            enterKeyHint="done"
            onChange={(e) => setScoreText(e.target.value)}
          />
        </label>
        <button
          type="button"
          data-testid="form-favorite"
          aria-pressed={favorite}
          onClick={() => setFavorite(!favorite)}
        >
          <span className={favorite ? 'fav-on' : 'fav-off'}>{favorite ? '★' : '☆'}</span>{' '}
          {ja.record.favorite}
        </button>
      </div>
      {!score.ok && (
        <p className="danger small" data-testid="form-score-error">
          {score.reason === 'outOfRange' ? ja.record.scoreOutOfRange : ja.record.scoreNotNumber}
        </p>
      )}

      <label className="field">
        <span>{ja.record.shotAt}</span>
        <input
          type="datetime-local"
          data-testid="form-shot-at"
          className={shotAt === null ? 'input-error' : undefined}
          value={shotAtText}
          onChange={(e) => setShotAtText(e.target.value)}
        />
        {mode === 'save' && <span>{ja.record.shotAtHintSave}</span>}
      </label>
      {shotAt === null && <p className="danger small">{ja.record.shotAtInvalid}</p>}

      {/* 保存時は入力の手間を減らすため畳んでおく。編集時は開いておく */}
      <details className="fold" open={mode === 'edit' || initial.memo !== ''}>
        <summary data-testid="form-memo-toggle">{ja.record.memo}</summary>
        <textarea
          data-testid="form-memo"
          aria-label={ja.record.memo}
          rows={3}
          maxLength={500}
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
        />
      </details>

      {failed && (
        <div className="notice err" data-testid="form-failed">
          <strong>{ja.save.failedTitle}</strong>
          <p className="small">{ja.save.failedBody}</p>
        </div>
      )}

      <div className="row nowrap">
        <button type="button" data-testid="form-cancel" disabled={busy} onClick={onCancel}>
          {ja.common.cancel}
        </button>
        <button
          type="button"
          className="primary grow"
          data-testid="form-submit"
          disabled={!canSubmit}
          onClick={() => void submit()}
        >
          {busy ? ja.save.saving : mode === 'save' ? ja.record.submitSave : ja.record.submitEdit}
        </button>
      </div>

      {addingShooter && (
        <ShooterDialog
          shooters={shooters}
          onCancel={() => setAddingShooter(false)}
          onDone={(id) => {
            void onShootersChanged().then(() => {
              setShooterId(id);
              setAddingShooter(false);
            });
          }}
        />
      )}
    </Dialog>
  );
}
