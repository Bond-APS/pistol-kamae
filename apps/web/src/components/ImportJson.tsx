import type { Handedness } from '@pistol-kamae/engine';
import { useEffect, useRef, useState } from 'react';
import { listKnownRecordKeys } from '../db/library';
import type { ShooterRow } from '../db/schema';
import { planImport, type ImportPlan, type PlannedShooter } from '../export/importPlan';
import { importRecords, type ImportOutcome } from '../export/importRecords';
import { parseExportText, type ExportFile, type ParseProblem } from '../export/json';
import { ja } from '../i18n/ja';
import { VIDEO_MAX_BYTES, VIDEO_MAX_MB } from '../video/limits';
import { Dialog } from './Dialog';

interface Props {
  shooters: ShooterRow[];
  /** 読み込みが終わったとき（1 件も書かなくても呼ぶ。射手を登録・修正したことがあるため） */
  onImported: (ids: number[]) => void;
  /** 読み取り・書き込みの間（一覧を押せなくしてもらうため。2026-10-13、開発者の決定） */
  onBusyChange: (busy: boolean) => void;
  testId: string;
}

/** 読み取ったファイルと、途中の決めごと */
interface Pending {
  file: ExportFile;
  /** 形式が合わず飛ばした件数 */
  skippedInvalid: number;
  plan: ImportPlan;
  /** 利き手の食い違いがある射手のうち、まだ聞いていないもの */
  conflicts: PlannedShooter[];
  /** 射手の名前ごとに決めた利き手 */
  decisions: Map<string, Handedness>;
}

/**
 * 読み込むファイルの大きさの上限。動画本体の上限（200 MB）を base64 にした大きさに、静止画や関節の位置の分を足したもの。
 * これより大きいファイルは、動画が上限を超えていて保存できないうえ、文字列として読むだけでメモリが足りなくなる
 */
const IMPORT_MAX_BYTES = Math.ceil((VIDEO_MAX_BYTES * 4) / 3) + 32 * 1024 * 1024;

type Phase =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'problem'; problem: ParseProblem | 'failed' | 'tooLarge' }
  | { kind: 'askHandedness'; pending: Pending }
  | { kind: 'askDuplicates'; pending: Pending }
  | { kind: 'importing'; done: number; total: number }
  | { kind: 'done'; outcome: ImportOutcome; skippedInvalid: number; skippedDuplicate: number };

const problemText: Record<ParseProblem | 'failed' | 'tooLarge', string> = {
  tooLarge: ja.importJson.tooLarge(VIDEO_MAX_MB),
  notJson: ja.importJson.broken,
  notKamae: ja.importJson.notKamae,
  unsupportedVersion: ja.importJson.unsupportedVersion,
  noRecords: ja.importJson.noRecords,
  failed: ja.importJson.failed,
};

/**
 * 「JSON を読み込む」ボタンと、その流れ（ファイルを選ぶ → 検査 → 利き手の食い違い → 重複 → 書き込み → 結果）。
 * 利き手の食い違いは射手ごとに 1 回、重複は全体で 1 回だけ聞く（2026-10-12、開発者の決定）
 */
export function ImportJson({ shooters, onImported, onBusyChange, testId }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const busy = phase.kind === 'reading' || phase.kind === 'importing';
  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);
  // 画面を離れるときは「読み込み中」を解く
  useEffect(() => () => onBusyChange(false), [onBusyChange]);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > IMPORT_MAX_BYTES) {
      setPhase({ kind: 'problem', problem: 'tooLarge' });
      return;
    }
    setPhase({ kind: 'reading' });
    try {
      const parsed = parseExportText(await file.text());
      if (parsed.kind === 'problem') {
        setPhase({ kind: 'problem', problem: parsed.problem });
        return;
      }
      const known = await listKnownRecordKeys();
      const plan = planImport(
        parsed.file.records.map((r) => r.record),
        shooters.map((s) => ({ name: s.name, handedness: s.handedness })),
        known,
      );
      proceed({
        file: parsed.file,
        skippedInvalid: parsed.skipped,
        plan,
        conflicts: plan.shooters.filter((s) => s.conflict),
        decisions: new Map(),
      });
    } catch {
      setPhase({ kind: 'problem', problem: 'failed' });
    }
  };

  /** 次に聞くことがあれば聞き、なければ書き込む */
  const proceed = (pending: Pending, skipDuplicates?: boolean) => {
    if (pending.conflicts.length > 0) {
      setPhase({ kind: 'askHandedness', pending });
      return;
    }
    if (pending.plan.duplicates.length > 0 && skipDuplicates === undefined) {
      setPhase({ kind: 'askDuplicates', pending });
      return;
    }
    void run(pending, skipDuplicates === true);
  };

  const decideHandedness = (pending: Pending, shooter: PlannedShooter, handedness: Handedness) => {
    const decisions = new Map(pending.decisions);
    decisions.set(shooter.name, handedness);
    proceed({ ...pending, decisions, conflicts: pending.conflicts.slice(1) });
  };

  const run = async (pending: Pending, skipDuplicates: boolean) => {
    const dup = new Set(pending.plan.duplicates);
    const items = pending.file.records.filter((_, i) => !skipDuplicates || !dup.has(i));
    const total = items.length;
    setPhase({ kind: 'importing', done: 0, total });
    try {
      const outcome = await importRecords(items, pending.decisions, (done) =>
        setPhase({ kind: 'importing', done, total }),
      );
      setPhase({
        kind: 'done',
        outcome,
        skippedInvalid: pending.skippedInvalid,
        skippedDuplicate: skipDuplicates ? dup.size : 0,
      });
      onImported(outcome.ids);
    } catch {
      setPhase({ kind: 'problem', problem: 'failed' });
      onImported([]);
    }
  };

  const cancel = () => setPhase({ kind: 'idle' });

  return (
    <div data-testid={testId} data-phase={phase.kind}>
      <button
        className="full"
        data-testid={`${testId}-button`}
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {phase.kind === 'reading'
          ? ja.importJson.reading
          : phase.kind === 'importing'
            ? ja.importJson.importing(phase.done, phase.total)
            : ja.importJson.button}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        hidden
        data-testid={`${testId}-file`}
        onChange={(e) => {
          void onPick(e.target.files?.[0]);
          // 同じファイルを選び直しても反応するように、選択を消しておく
          e.target.value = '';
        }}
      />
      {phase.kind === 'problem' && (
        <p className="danger small" data-testid={`${testId}-problem`}>
          {problemText[phase.problem]}
        </p>
      )}
      {phase.kind === 'done' && (
        <div className="notice ok" data-testid={`${testId}-done`}>
          <strong>
            {phase.outcome.ids.length > 0
              ? ja.importJson.doneTitle(phase.outcome.ids.length)
              : ja.importJson.doneNone}
          </strong>
          {phase.skippedInvalid > 0 && (
            <p className="small">{ja.importJson.skippedInvalid(phase.skippedInvalid)}</p>
          )}
          {phase.skippedDuplicate > 0 && (
            <p className="small">{ja.importJson.skippedDuplicate(phase.skippedDuplicate)}</p>
          )}
          {phase.outcome.failed > 0 && (
            <p className="danger small">{ja.importJson.failedSome(phase.outcome.failed)}</p>
          )}
          {phase.outcome.videoTooLarge > 0 && (
            <p className="small">
              {ja.importJson.videoTooLarge(phase.outcome.videoTooLarge, VIDEO_MAX_MB)}
            </p>
          )}
          {phase.outcome.videoFailed > 0 && (
            <p className="danger small">{ja.importJson.videoFailed(phase.outcome.videoFailed)}</p>
          )}
        </div>
      )}
      {phase.kind === 'askHandedness' && (
        <HandednessDialog
          shooter={phase.pending.conflicts[0]!}
          onDecide={(h) => decideHandedness(phase.pending, phase.pending.conflicts[0]!, h)}
          onCancel={cancel}
        />
      )}
      {phase.kind === 'askDuplicates' && (
        <DuplicatesDialog
          duplicates={phase.pending.plan.duplicates.length}
          total={phase.pending.file.records.length}
          onImportAll={() => proceed(phase.pending, false)}
          onSkip={() => proceed(phase.pending, true)}
          onCancel={cancel}
        />
      )}
    </div>
  );
}

function HandednessDialog(props: {
  shooter: PlannedShooter;
  onDecide: (handedness: Handedness) => void;
  onCancel: () => void;
}) {
  const { shooter, onDecide, onCancel } = props;
  const registered = shooter.registered!.handedness;
  return (
    <Dialog
      variant="confirm"
      title={ja.importJson.handednessTitle}
      onCancel={onCancel}
      testId="import-handedness-dialog"
    >
      <p className="small">
        {ja.importJson.handednessBody(shooter.name, shooter.handedness, registered)}
      </p>
      <div className="stack">
        <button
          className="primary full"
          data-testid="import-keep-registered"
          onClick={() => onDecide(registered)}
        >
          {ja.importJson.keepRegistered(registered)}
        </button>
        <button
          className="full"
          data-testid="import-use-file"
          onClick={() => onDecide(shooter.handedness)}
        >
          {ja.importJson.useFile(shooter.handedness)}
        </button>
        <button className="full" data-testid="confirm-cancel" onClick={onCancel}>
          {ja.common.cancel}
        </button>
      </div>
    </Dialog>
  );
}

function DuplicatesDialog(props: {
  duplicates: number;
  total: number;
  onImportAll: () => void;
  onSkip: () => void;
  onCancel: () => void;
}) {
  const { duplicates, total, onImportAll, onSkip, onCancel } = props;
  const single = total === 1;
  return (
    <Dialog
      variant="confirm"
      title={ja.importJson.duplicateTitle}
      onCancel={onCancel}
      testId="import-duplicate-dialog"
    >
      <p className="small">
        {single ? ja.importJson.duplicateOne : ja.importJson.duplicateMany(duplicates, total)}
      </p>
      <div className="stack">
        {single ? (
          <button className="primary full" data-testid="import-all" onClick={onImportAll}>
            {ja.importJson.importAnyway}
          </button>
        ) : (
          <>
            <button className="primary full" data-testid="import-skip-duplicates" onClick={onSkip}>
              {ja.importJson.skipDuplicates}
            </button>
            <button className="full" data-testid="import-all" onClick={onImportAll}>
              {ja.importJson.importAll}
            </button>
          </>
        )}
        <button className="full" data-testid="confirm-cancel" onClick={onCancel}>
          {ja.common.cancel}
        </button>
      </div>
    </Dialog>
  );
}
