import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { RecordSummary } from '../components/RecordSummary';
import { listRecords, setRecordFavorite } from '../db/library';
import type { RecordRow, ShooterRow } from '../db/schema';
import { ja } from '../i18n/ja';
import {
  NO_FILTER,
  countByShooter,
  filterAndSort,
  groupByMonth,
  isFiltered,
  type ListFilter,
} from '../library/listView';
import { RecordDetail } from './RecordDetail';

interface Props {
  /** このタブが表示中か。表示されるたびに一覧を読み直す */
  active: boolean;
  shooters: ShooterRow[];
  onShootersChanged: () => Promise<void>;
  onGoLoad: () => void;
  onRecordChanged: (id: number) => void;
  onRecordDeleted: (id: number) => void;
  /** 開いた記録を「今回」として、基準と比べる */
  onCompare: (id: number) => void;
}

/** ブラウザの「戻る」の履歴に付ける目印。記録を開いている間だけ積む */
interface DetailState {
  kamaeDetail: number;
}
const detailIdOf = (state: unknown): number | null => {
  const id = (state as Partial<DetailState> | null)?.kamaeDetail;
  return typeof id === 'number' ? id : null;
};

/** ライブラリ画面：保存した記録の一覧と、開いた 1 件 */
export function LibraryScreen(props: Props) {
  const { active, shooters, onShootersChanged, onGoLoad, onRecordChanged, onRecordDeleted } = props;
  const [rows, setRows] = useState<RecordRow[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [filter, setFilter] = useState<ListFilter>(NO_FILTER);
  const [openId, setOpenId] = useState<number | null>(null);
  /** 記録を開く前の一覧のスクロール位置。戻ったときに復元する */
  const listScrollY = useRef(0);

  const reload = useCallback(
    () =>
      listRecords().then(
        (list) => {
          setRows(list);
          setLoadFailed(false);
        },
        () => setLoadFailed(true),
      ),
    [],
  );

  useEffect(() => {
    if (active) void reload();
    // 別のタブへ移るときは、開いていた記録を閉じて一覧に戻しておく
    else if (detailIdOf(window.history.state) !== null) window.history.back();
  }, [active, reload]);

  // 記録を開いている間は履歴を 1 つ積み、ブラウザの「戻る」（iPhone では画面左端からのスワイプ）で
  // 一覧へ戻れるようにする
  useEffect(() => {
    // 再読込の直後に目印だけが残っていたら消す
    if (detailIdOf(window.history.state) !== null) window.history.replaceState(null, '');
    const onPop = (e: PopStateEvent) => setOpenId(detailIdOf(e.state));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // 記録を開いたら先頭へ、一覧へ戻ったら元の位置へ。別のタブを表示中は動かさない
  const activeRef = useRef(active);
  useLayoutEffect(() => {
    activeRef.current = active;
  }, [active]);
  useLayoutEffect(() => {
    if (activeRef.current) window.scrollTo(0, openId === null ? listScrollY.current : 0);
  }, [openId]);

  const open = (id: number) => {
    listScrollY.current = window.scrollY;
    window.history.pushState({ kamaeDetail: id } satisfies DetailState, '');
    setOpenId(id);
  };
  const close = () => {
    if (detailIdOf(window.history.state) !== null) window.history.back();
    else setOpenId(null);
  };

  const shooterById = useMemo(() => new Map(shooters.map((s) => [s.id, s])), [shooters]);
  const counts = useMemo(() => countByShooter(rows ?? []), [rows]);
  const shown = useMemo(() => filterAndSort(rows ?? [], filter), [rows, filter]);
  const groups = useMemo(() => groupByMonth(shown), [shown]);

  if (openId !== null) {
    return (
      <RecordDetail
        key={openId}
        recordId={openId}
        shooters={shooters}
        onShootersChanged={onShootersChanged}
        onClose={close}
        onChanged={(id) => {
          void reload();
          onRecordChanged(id);
        }}
        onCompare={props.onCompare}
        onDeleted={(id) => {
          void reload();
          onRecordDeleted(id);
          close();
        }}
      />
    );
  }

  const toggleFavorite = async (row: RecordRow) => {
    // 押したらすぐ画面に反映し、保存に失敗したら読み直して元に戻す
    setRows(
      (rs) => rs?.map((r) => (r.id === row.id ? { ...r, favorite: !row.favorite } : r)) ?? rs,
    );
    try {
      await setRecordFavorite(row.id, !row.favorite);
      onRecordChanged(row.id);
    } catch {
      await reload();
    }
  };

  const total = rows?.length ?? 0;

  return (
    <section data-testid="library">
      <h2>{ja.library.title}</h2>

      {loadFailed && (
        <div className="notice err">
          <strong>{ja.library.loadFailed}</strong>
        </div>
      )}
      {rows === null && !loadFailed && <p className="muted">{ja.library.loading}</p>}

      {rows !== null && total === 0 && (
        <div data-testid="library-empty">
          <p>{ja.library.empty}</p>
          <button className="primary full" data-testid="library-go-load" onClick={onGoLoad}>
            {ja.common.goLoad}
          </button>
        </div>
      )}

      {rows !== null && total > 0 && (
        <>
          {shooters.length >= 2 && (
            <select
              className="full"
              data-testid="filter-shooter"
              aria-label={ja.library.filterShooter}
              value={filter.shooterId ?? ''}
              onChange={(e) =>
                setFilter({
                  ...filter,
                  shooterId: e.target.value === '' ? null : Number(e.target.value),
                })
              }
            >
              <option value="">{ja.library.allShooters(total)}</option>
              {shooters.map((s) => (
                <option key={s.id} value={s.id}>
                  {ja.library.shooterOption(s.name, counts.get(s.id) ?? 0)}
                </option>
              ))}
            </select>
          )}
          <div className="row">
            <button
              className="chip"
              data-testid="filter-favorite"
              aria-pressed={filter.favoritesOnly}
              onClick={() => setFilter({ ...filter, favoritesOnly: !filter.favoritesOnly })}
            >
              <span className={filter.favoritesOnly ? 'fav-on' : 'fav-off'}>
                {filter.favoritesOnly ? '★' : '☆'}
              </span>
              &nbsp;{ja.library.favoritesOnly}
            </button>
            <span className="muted small" data-testid="library-count">
              {ja.library.count(shown.length, total)}
            </span>
          </div>

          {shown.length === 0 && (
            <div data-testid="library-no-match">
              <p>{ja.library.noMatch}</p>
              {isFiltered(filter) && (
                <button data-testid="filter-clear" onClick={() => setFilter(NO_FILTER)}>
                  {ja.library.clearFilter}
                </button>
              )}
            </div>
          )}

          {groups.map((group) => (
            <div key={`${group.year}-${group.month}`}>
              <p className="lib-month" data-testid="lib-month">
                {ja.library.month(group.year, group.month, group.rows.length)}
              </p>
              <ul className="lib-list">
                {group.rows.map((r) => (
                  <li
                    key={r.id}
                    className="lib-item"
                    data-testid="lib-item"
                    data-record-id={r.id}
                    data-favorite={r.favorite}
                  >
                    <button className="lib-open" data-testid="lib-open" onClick={() => open(r.id)}>
                      <RecordSummary
                        row={r}
                        shooterName={shooterById.get(r.shooterId)?.name ?? ''}
                      />
                    </button>
                    <button
                      className={r.favorite ? 'icon fav-on' : 'icon fav-off'}
                      data-testid="lib-favorite"
                      aria-pressed={r.favorite}
                      aria-label={r.favorite ? ja.library.removeFavorite : ja.library.addFavorite}
                      onClick={() => void toggleFavorite(r)}
                    >
                      {r.favorite ? '★' : '☆'}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
