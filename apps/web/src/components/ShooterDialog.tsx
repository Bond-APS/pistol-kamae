import {
  SHOOTER_NAME_MAX_LENGTH,
  hasShooterName,
  normalizeShooterName,
  type Handedness,
} from '@pistol-kamae/engine';
import { useState } from 'react';
import { DuplicateShooterError, addShooter, updateShooter } from '../db/library';
import type { ShooterRow } from '../db/schema';
import { ja } from '../i18n/ja';
import { Dialog } from './Dialog';

interface Props {
  shooters: ShooterRow[];
  /** 編集する射手。新しく登録するときは渡さない */
  editing?: ShooterRow;
  /** 登録・変更が終わったとき。引数はその射手の番号 */
  onDone: (shooterId: number) => void;
  onCancel: () => void;
}

/** 射手の登録・編集。利き手は射手ごとに 1 回だけ決める */
export function ShooterDialog({ shooters, editing, onDone, onCancel }: Props) {
  const [nameText, setNameText] = useState(editing?.name ?? '');
  const [handedness, setHandedness] = useState<Handedness>(editing?.handedness ?? 'right');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const name = normalizeShooterName(nameText);
  const duplicate = hasShooterName(shooters, nameText, editing?.name);

  const submit = async () => {
    if (name === null || duplicate || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      if (editing) {
        await updateShooter(editing.id, name, handedness);
        onDone(editing.id);
      } else {
        onDone(await addShooter(name, handedness));
      }
    } catch (e) {
      // 同じ名前の重複は入力中に案内済み。ここに来るのは保存そのものの失敗
      if (!(e instanceof DuplicateShooterError)) setFailed(true);
      setBusy(false);
    }
  };

  return (
    <Dialog
      variant="confirm"
      title={editing ? ja.shooter.editTitle : ja.shooter.registerTitle}
      onCancel={onCancel}
      testId="shooter-dialog"
    >
      <label className="field">
        <span>{ja.shooter.name}</span>
        <input
          type="text"
          data-testid="shooter-name"
          className={duplicate ? 'input-error' : undefined}
          value={nameText}
          maxLength={SHOOTER_NAME_MAX_LENGTH}
          autoComplete="off"
          onChange={(e) => setNameText(e.target.value)}
        />
      </label>
      {duplicate && (
        <p className="danger small" data-testid="shooter-duplicate">
          {ja.shooter.nameDuplicate}
        </p>
      )}
      <div className="field">
        <span>{ja.shooter.handedness}</span>
        <div className="seg">
          {(['right', 'left'] as const).map((h) => (
            <button
              key={h}
              type="button"
              data-testid={`shooter-${h}`}
              aria-pressed={handedness === h}
              onClick={() => setHandedness(h)}
            >
              {ja.shooter[h]}
            </button>
          ))}
        </div>
        <span>{editing ? ja.shooter.editHint : ja.shooter.handednessHint}</span>
      </div>
      {failed && <p className="danger small">{ja.shooter.failed}</p>}
      <div className="row nowrap">
        <button type="button" data-testid="shooter-cancel" disabled={busy} onClick={onCancel}>
          {ja.common.cancel}
        </button>
        <button
          type="button"
          className="primary grow"
          data-testid="shooter-submit"
          disabled={name === null || duplicate || busy}
          onClick={() => void submit()}
        >
          {busy ? ja.shooter.saving : editing ? ja.shooter.saveEdit : ja.shooter.register}
        </button>
      </div>
    </Dialog>
  );
}
