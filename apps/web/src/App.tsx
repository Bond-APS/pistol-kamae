import type { Handedness } from '@pistol-kamae/engine';
import { lazy, Suspense, useState } from 'react';
import type { AnalysisResult } from './analysis/runAnalysis';
import { DevErrorBanner } from './components/DevErrorBanner';
import { ja } from './i18n/ja';
import { LoadScreen } from './screens/LoadScreen';
import { NoiseScreen } from './screens/NoiseScreen';

type Tab = 'load' | 'noise';

// 開発サーバ限定の自動テストモード（?autotest=1）。公開ビルドでは読み込まない
const AutoTest = import.meta.env.DEV ? lazy(() => import('./dev/AutoTest')) : null;
const autoTestRequested =
  import.meta.env.DEV && new URLSearchParams(window.location.search).has('autotest');

export function App() {
  const [tab, setTab] = useState<Tab>('load');
  const [handedness, setHandedness] = useState<Handedness>('right');
  const [result, setResult] = useState<AnalysisResult | null>(null);

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

  return (
    <main className="app">
      <header>
        <h1>{ja.app.title}</h1>
        <p className="muted small">{ja.app.stageNote}</p>
      </header>

      <DevErrorBanner />

      <nav className="tabs">
        <button className={tab === 'load' ? 'tab active' : 'tab'} onClick={() => setTab('load')}>
          {ja.tabs.load}
        </button>
        <button className={tab === 'noise' ? 'tab active' : 'tab'} onClick={() => setTab('noise')}>
          {ja.tabs.noise}
        </button>
      </nav>

      {/* 読込画面は隠すだけにして、動画と処理状態を保つ */}
      <div hidden={tab !== 'load'}>
        <LoadScreen
          handedness={handedness}
          onHandednessChange={setHandedness}
          result={result}
          onResult={setResult}
        />
      </div>
      {tab === 'noise' && <NoiseScreen result={result} handedness={handedness} />}
    </main>
  );
}
