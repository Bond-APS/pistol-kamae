import type { Handedness } from '@pistol-kamae/engine';
import { useState } from 'react';
import type { AnalysisResult } from './analysis/runAnalysis';
import { DEFAULT_BACKEND, type BackendChoice } from './config/backends';
import { ja } from './i18n/ja';
import { LoadScreen } from './screens/LoadScreen';
import { NoiseScreen } from './screens/NoiseScreen';

type Tab = 'load' | 'noise';

export function App() {
  const [tab, setTab] = useState<Tab>('load');
  const [backend, setBackend] = useState<BackendChoice>(DEFAULT_BACKEND);
  const [handedness, setHandedness] = useState<Handedness>('right');
  const [result, setResult] = useState<AnalysisResult | null>(null);

  return (
    <main className="app">
      <header>
        <h1>{ja.app.title}</h1>
        <p className="muted small">{ja.app.stageNote}</p>
      </header>

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
          backend={backend}
          onBackendChange={setBackend}
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
