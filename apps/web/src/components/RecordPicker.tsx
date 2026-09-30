import { useEffect, useMemo, useState } from 'react';
import { listRecords } from '../db/library';
import type { RecordRow, ShooterRow } from '../db/schema';
import { ja } from '../i18n/ja';
import { countByShooter, filterAndSort } from '../library/listView';
import { Dialog } from './Dialog';
import { RecordSummary } from './RecordSummary';

interface Props {
  /** base：基準を選ぶ（お気に入りのみ）、current：今回を選ぶ（すべての記録から） */
  role: 'base' | 'current';
  shooters: ShooterRow[];
  /** いま選ばれている記録（✓ を付ける） */
  selectedId: number | null;
  /** 比べる相手として選ばれている記録（同じ記録どうしは比べられないので一覧から外す） */
  excludeId: number | null;
  /** 射手の絞り込みの初期値（相手の記録の射手）。null はすべて */
  initialShooterId: number | null;
  onPick: (id: number) => void;
  onCancel: () => void;
  /** 基準の候補（お気に入り）が無いとき：ライブラリで ☆ を押してもらう */
  onGoLibrary: () => void;
  /** 記録が 1 件も無いとき：動画を読み込んでもらう */
  onGoLoad: () => void;
}

/** 比較する記録を選ぶ窓。行を押すとすぐ決まる */
export function RecordPicker(props: Props) {
  const { role, shooters, selectedId, excludeId, initialShooterId, onPick, onCancel } = props;
  const [rows, setRows] = useState<RecordRow[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [shooterId, setShooterId] = useState<number | null>(initialShooterId);
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  useEffect(() => {
    let alive = true;
    void listRecords().then(
      (list) => {
        if (alive) setRows(list);
      },
      () => {
        if (alive) setLoadFailed(true);
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  const shooterById = useMemo(() => new Map(shooters.map((s) => [s.id, s])), [shooters]);
  // 選べる記録：相手の記録を除き、基準はお気に入りだけ
  const candidates = useMemo(
    () => (rows ?? []).filter((r) => r.id !== excludeId && (role === 'current' || r.favorite)),
    [rows, excludeId, role],
  );
  const counts = useMemo(() => countByShooter(candidates), [candidates]);
  const shown = useMemo(
    () =>
      filterAndSort(candidates, { shooterId, favoritesOnly: role === 'current' && favoritesOnly }),
    [candidates, shooterId, favoritesOnly, role],
  );

  return (
    <Dialog
      variant="sheet"
      title={role === 'base' ? ja.compare.pickBaseTitle : ja.compare.pickCurrentTitle}
      onCancel={onCancel}
      testId="record-picker"
    >
      <p className="muted small">
        {role === 'base' ? ja.compare.pickBaseHint : ja.compare.pickCurrentHint}
      </p>

      {loadFailed && (
        <div className="notice err">
          <strong>{ja.library.loadFailed}</strong>
        </div>
      )}
      {rows === null && !loadFailed && <p className="muted">{ja.library.loading}</p>}

      {rows !== null && candidates.length === 0 && (
        <div data-testid="picker-empty">
          <p>{role === 'base' ? ja.compare.pickNoFavorite : ja.compare.pickNoRecord}</p>
          {role === 'base' ? (
            <button
              className="primary full"
              data-testid="picker-go-library"
              onClick={props.onGoLibrary}
            >
              {ja.compare.goLibrary}
            </button>
          ) : (
            <button className="primary full" data-testid="picker-go-load" onClick={props.onGoLoad}>
              {ja.common.goLoad}
            </button>
          )}
        </div>
      )}

      {rows !== null && candidates.length > 0 && (
        <>
          {shooters.length >= 2 && (
            <select
              className="full"
              data-testid="picker-shooter"
              aria-label={ja.library.filterShooter}
              value={shooterId ?? ''}
              onChange={(e) => setShooterId(e.target.value === '' ? null : Number(e.target.value))}
            >
              <option value="">{ja.library.allShooters(candidates.length)}</option>
              {shooters.map((s) => (
                <option key={s.id} value={s.id}>
                  {ja.library.shooterOption(s.name, counts.get(s.id) ?? 0)}
                </option>
              ))}
            </select>
          )}
          {role === 'current' && (
            <div className="row">
              <button
                className="chip"
                data-testid="picker-favorite"
                aria-pressed={favoritesOnly}
                onClick={() => setFavoritesOnly(!favoritesOnly)}
              >
                <span className={favoritesOnly ? 'fav-on' : 'fav-off'}>
                  {favoritesOnly ? '★' : '☆'}
                </span>
                &nbsp;{ja.library.favoritesOnly}
              </button>
            </div>
          )}
          {shown.length === 0 && <p data-testid="picker-no-match">{ja.compare.pickNoMatch}</p>}
          <ul className="lib-list">
            {shown.map((r) => (
              <li
                key={r.id}
                className={r.id === selectedId ? 'lib-item selected' : 'lib-item'}
                data-testid="picker-item"
                data-record-id={r.id}
              >
                <button
                  className="lib-open"
                  data-testid="picker-pick"
                  aria-current={r.id === selectedId ? 'true' : undefined}
                  onClick={() => onPick(r.id)}
                >
                  <RecordSummary row={r} shooterName={shooterById.get(r.shooterId)?.name ?? ''} />
                </button>
                {r.id === selectedId && (
                  <span className="picker-check" aria-label={ja.compare.selected}>
                    ✓
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="stack">
        <button className="full" data-testid="picker-cancel" onClick={onCancel}>
          {ja.common.cancel}
        </button>
      </div>
    </Dialog>
  );
}
