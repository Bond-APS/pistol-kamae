import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { AnalysisResult } from './analysis/runAnalysis';
import { DevErrorBanner } from './components/DevErrorBanner';
import { InstallNotice } from './components/InstallNotice';
import { UpdateBanner } from './components/UpdateBanner';
import {
  EMPTY_PAIR,
  getComparePair,
  getLastShooterId,
  listShooters,
  setComparePair,
  setLastShooterId,
  type ComparePair,
} from './db/library';
import type { ShooterRow } from './db/schema';
import { ja } from './i18n/ja';
import { createNav, type NavEntry } from './navigation/history';
import { NavProvider } from './navigation/NavProvider';
import { useNavListener } from './navigation/useNav';
import { CompareScreen } from './screens/CompareScreen';
import { LibraryScreen } from './screens/LibraryScreen';
import { NoiseScreen } from './screens/NoiseScreen';
import { SaveScreen, type SaveStep } from './screens/SaveScreen';

/** 入口は 2 つ。比較はライブラリから入る（タブではない）。ノイズ測定は開発用で、?noise=1 のときだけ */
type Tab = 'save' | 'library' | 'noise';
type View = Tab | 'compare';

// 開発サーバ限定の自動テストモード（?autotest=1）。公開ビルドでは読み込まない
const AutoTest = import.meta.env.DEV ? lazy(() => import('./dev/AutoTest')) : null;
const params = new URLSearchParams(window.location.search);
const autoTestRequested = import.meta.env.DEV && params.has('autotest');
const TABS: Tab[] = params.has('noise') ? ['save', 'library', 'noise'] : ['save', 'library'];

/**
 * 画面の履歴（最終-10）。起点は「動画の保存」の射手の選択。段階が進むたびに各画面が 1 つ積み、
 * ブラウザの「戻る」（iPhone の画面左端からのスワイプ）で 1 つ前の段階へ戻れるようにする
 */
const nav = createNav({ view: 'save', step: 'shooter' });

export function App() {
  return (
    <NavProvider nav={nav}>
      <AppBody />
    </NavProvider>
  );
}

function AppBody() {
  const [view, setView] = useState<View>('save');
  /** 保存の流れの今の段階（タブの切り替えで積む項目に書くため） */
  const [saveStep, setSaveStep] = useState<SaveStep>('shooter');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [shooters, setShooters] = useState<ShooterRow[]>([]);
  /** 起動時の射手の一覧を読み終えたか（読み終える前に「射手を登録」を出さないため） */
  const [shootersReady, setShootersReady] = useState(false);
  const [shooterId, setShooterId] = useState<number | null>(null);
  const [dbFailed, setDbFailed] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  // 比較する 2 件（①基準・②比較）。端末に覚えておき、次に開いたときも同じ 2 件を出す
  const [pair, setPair] = useState<ComparePair>(EMPTY_PAIR);
  /** ライブラリの一覧を読み直してもらうための番号（保存・修正のたびに増やす） */
  const [libraryVersion, setLibraryVersion] = useState(0);
  // 推定に使う video 要素。読込画面が作り、推定が終わったら解放する
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const reloadShooters = useCallback(async () => {
    try {
      setShooters(await listShooters());
    } catch {
      setDbFailed(true);
    }
  }, []);

  // 起動時：射手の一覧を読み、前回の射手と比較の 2 件を選んでおく
  useEffect(() => {
    void (async () => {
      try {
        const [list, lastId, lastPair] = await Promise.all([
          listShooters(),
          getLastShooterId(),
          getComparePair(),
        ]);
        setShooters(list);
        setShooterId((current) => current ?? lastId);
        setPair(lastPair);
      } catch {
        setDbFailed(true);
      }
      setShootersReady(true);
    })();
  }, []);

  // 選択中の射手。前回の射手が見つからなければ最初の 1 人
  const shooter = shooters.find((s) => s.id === shooterId) ?? shooters[0] ?? null;
  const handedness = shooter?.handedness ?? 'right';

  const changeShooter = useCallback((id: number) => {
    setShooterId(id);
    void setLastShooterId(id).catch(() => {});
  }, []);

  // 履歴の項目が知らされたら（タブの切り替え、各画面の段階、ブラウザの「戻る」）、その画面を出す
  useNavListener((entry) => {
    if (view !== entry.view) window.scrollTo(0, 0);
    setView(entry.view);
  });
  /** タブに対応する履歴の項目。「動画の保存」は今の段階のまま */
  const entryForTab = useCallback(
    (t: Tab, step: SaveStep = saveStep): NavEntry =>
      t === 'save' ? { view: 'save', step } : { view: t },
    [saveStep],
  );
  const changeTab = useCallback(
    (t: Tab) => {
      if (t !== view) nav.push(entryForTab(t));
    },
    [view, entryForTab],
  );
  const [newRequest, setNewRequest] = useState(0);
  // ライブラリの「動画を読み込む」：保存し終えた状態なら射手の選択から、途中ならその段階のまま
  const goLoad = useCallback(() => {
    setNewRequest((n) => n + 1);
    nav.push(entryForTab('save', saveStep === 'done' ? 'shooter' : saveStep));
  }, [entryForTab, saveStep]);
  /** 保存の完了からライブラリへ（進む） */
  const goLibrary = useCallback(() => nav.push({ view: 'library' }), []);
  /** 比較画面の「← ライブラリへ」（比較を 1 つ積んであるので、戻る） */
  const backToLibrary = useCallback(() => nav.back({ view: 'library' }), []);
  const goCompare = useCallback(() => nav.push({ view: 'compare' }), []);

  // 解析結果があって保存していないときは、タブを閉じる・再読込の前に確認を出す
  // （Mac・Windows・Android 向け。iPhone の Safari はこの確認を出さない）
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // 古いブラウザ向け（文面はブラウザが決める）
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  const changePair = useCallback((next: ComparePair) => {
    setPair(next);
    void setComparePair(next).catch(() => {});
  }, []);
  const bumpLibrary = useCallback(() => setLibraryVersion((v) => v + 1), []);
  const onRecordDeleted = useCallback(
    (id: number) => {
      bumpLibrary();
      // 比較に選んでいた記録が削除されたら、選び直しの状態に戻す
      if (pair.baseId === id || pair.currentId === id) {
        changePair({
          baseId: pair.baseId === id ? null : pair.baseId,
          currentId: pair.currentId === id ? null : pair.currentId,
        });
      }
    },
    [pair, changePair, bumpLibrary],
  );

  if (AutoTest && autoTestRequested) {
    return (
      <main className="app">
        <DevErrorBanner />
        <Suspense fallback={null}>
          <AutoTest />
        </Suspense>
      </main>
    );
  }

  const tab: Tab | null = view === 'compare' ? null : view;

  return (
    <main className="app">
      <header>
        <h1>{ja.app.title}</h1>
        {import.meta.env.DEV && <p className="muted small">{ja.app.stageNote}</p>}
      </header>

      <DevErrorBanner />
      {dbFailed && (
        <div className="notice err" data-testid="db-failed">
          <strong>{ja.app.dbUnavailable}</strong>
        </div>
      )}
      <UpdateBanner unsaved={unsaved} />
      <InstallNotice />

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t}
            className={tab === t ? 'tab active' : 'tab'}
            data-testid={`tab-${t}`}
            aria-current={tab === t ? 'page' : undefined}
            onClick={() => changeTab(t)}
          >
            {ja.tabs[t]}
            {t === 'save' && unsaved && (
              <span
                className="status-dot"
                data-testid="unsaved-dot"
                aria-label={ja.tabs.unsavedAria}
              >
                ●
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="screens">
        {/* 保存の流れは隠すだけにして、処理状態を保つ */}
        <div hidden={view !== 'save'}>
          <SaveScreen
            active={view === 'save'}
            videoRef={videoRef}
            shooters={shooters}
            shootersReady={shootersReady}
            shooter={shooter}
            onShooterChange={changeShooter}
            onShootersChanged={reloadShooters}
            onUnsavedChange={setUnsaved}
            onStepChange={setSaveStep}
            onResultChange={setResult}
            newRequest={newRequest}
            onGoLibrary={goLibrary}
            onSaved={bumpLibrary}
          />
        </div>
        {/* ライブラリも隠すだけにして、絞り込みの状態を保つ */}
        <div hidden={view !== 'library'}>
          <LibraryScreen
            active={view === 'library'}
            version={libraryVersion}
            shooters={shooters}
            onShootersChanged={reloadShooters}
            onGoLoad={goLoad}
            onRecordChanged={bumpLibrary}
            onRecordDeleted={onRecordDeleted}
            pair={pair}
            onPairChange={changePair}
            onCompare={goCompare}
          />
        </div>
        {view === 'compare' && (
          <CompareScreen
            shooters={shooters}
            pair={pair}
            onPairChange={changePair}
            onGoLibrary={backToLibrary}
            onRecordChanged={bumpLibrary}
          />
        )}
        {view === 'noise' && (
          <NoiseScreen result={result} handedness={handedness} onGoLoad={goLoad} />
        )}
      </div>
    </main>
  );
}
