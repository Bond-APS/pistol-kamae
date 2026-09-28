import { ENGINE_VERSION } from '@pistol-kamae/engine';
import { ja } from './i18n/ja';

export function App() {
  return (
    <main className="app">
      <h1>{ja.app.title}</h1>
      <p className="muted">
        {ja.app.subtitle}（engine v{ENGINE_VERSION}）
      </p>
    </main>
  );
}
