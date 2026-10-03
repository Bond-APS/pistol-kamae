import {
  MEMO_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  normalizeLocalDateTime,
  normalizeMemo,
  normalizeTitle,
} from '@pistol-kamae/engine';
import { useState } from 'react';
import type { RecordFields } from '../db/library';
import type { ShooterRow } from '../db/schema';
import { ja } from '../i18n/ja';
import { ShooterDialog } from './ShooterDialog';

interface Props {
  /** save：保存の流れの最後、edit：ライブラリでの編集 */
  mode: 'save' | 'edit';
  shooters: ShooterRow[];
  initial: RecordFields;
  /** 保存する。失敗したら例外を投げる（入力を残したまま、エラーを表示する） */
  onSubmit: (fields: RecordFields) => Promise<void>;
  /** 編集のとき：取り消す */
  onCancel?: () => void;
  /** このフォームの中で射手を登録したとき（射手の一覧を読み直してもらう） */
  onShootersChanged: () => Promise<void>;
}

/**
 * 動画に付ける情報（タイトル・射手・撮影日時・メモ・お気に入り）の入力。
 * 保存時と編集時で同じ形を使う。利き手は射手に付いているので、ここでは選ばない。
 */
export function RecordForm(props: Props) {
  const { mode, shooters, initial, onSubmit, onCancel, onShootersChanged } = props;
  const [titleText, setTitleText] = useState(initial.title);
  const [shooterId, setShooterId] = useState(initial.shooterId);
  const [favorite, setFavorite] = useState(initial.favorite);
  const [shotAtText, setShotAtText] = useState(initial.shotAt);
  const [memoText, setMemoText] = useState(initial.memo);
  const [addingShooter, setAddingShooter] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const title = normalizeTitle(titleText);
  const shotAt = normalizeLocalDateTime(shotAtText);
  const memo = normalizeMemo(memoText);
  const canSubmit = title !== null && shotAt !== null && memo !== null && !busy;

  const submit = async () => {
    if (title === null || shotAt === null || memo === null || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await onSubmit({ title, shooterId, shotAt, memo, favorite });
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  return (
    <div className="record-form" data-testid="record-form">
      <label className="field">
        <span>{ja.record.title}</span>
        <input
          type="text"
          data-testid="form-title"
          className={title === null ? 'input-error' : undefined}
          value={titleText}
          maxLength={TITLE_MAX_LENGTH}
          autoComplete="off"
          enterKeyHint="done"
          onChange={(e) => setTitleText(e.target.value)}
        />
        {mode === 'save' && <span>{ja.record.titleHint}</span>}
      </label>
      {title === null && (
        <p className="danger small" data-testid="form-title-error">
          {ja.record.titleInvalid}
        </p>
      )}

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

      <label className="field">
        <span>{ja.record.memo(MEMO_MAX_LENGTH)}</span>
        <textarea
          data-testid="form-memo"
          className={memo === null ? 'input-error' : undefined}
          rows={3}
          maxLength={MEMO_MAX_LENGTH}
          placeholder={ja.record.memoPlaceholder}
          value={memoText}
          onChange={(e) => setMemoText(e.target.value)}
        />
      </label>
      {memo === null && <p className="danger small">{ja.record.memoTooLong(MEMO_MAX_LENGTH)}</p>}

      <div className="chips">
        <button
          type="button"
          className="chip"
          data-testid="form-favorite"
          aria-pressed={favorite}
          onClick={() => setFavorite(!favorite)}
        >
          <span className={favorite ? 'fav-on' : 'fav-off'}>{favorite ? '★' : '☆'}</span>{' '}
          {ja.record.favorite}
        </button>
      </div>

      {failed && (
        <div className="notice err" data-testid="form-failed">
          <strong>{ja.save.failedTitle}</strong>
          <p className="small">{ja.save.failedBody}</p>
        </div>
      )}

      <div className="row nowrap">
        {onCancel && (
          <button type="button" data-testid="form-cancel" disabled={busy} onClick={onCancel}>
            {ja.common.cancel}
          </button>
        )}
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
    </div>
  );
}
