import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { devReportPlugin } from './e2e/devReportPlugin';
import { ja } from './src/i18n/ja';

/** 取り置き（事前キャッシュ）する 1 ファイルの大きさの上限。MediaPipe の wasm（約 12 MB）とモデル（約 9 MB）を含める */
const PRECACHE_MAX_BYTES = 16 * 1024 * 1024;

// GitHub Pages では https://<ユーザー名>.github.io/pistol-kamae/ に置かれるため、
// 公開ビルドのときだけパスの先頭を /pistol-kamae/ にする。
// ビルド結果の確認（npm run preview）も同じ先頭にする（そうしないと、ビルドしたファイルを読めず画面が出ない）。
/** index.html の %PWA_…% に、ja.ts の文言を差し込む（文言をソースに直書きしないため） */
const pwaTextPlugin = (): Plugin => ({
  name: 'pwa-text',
  transformIndexHtml: (html) =>
    html
      .replaceAll('%PWA_DESCRIPTION%', ja.pwa.manifest.description)
      .replaceAll('%PWA_SHORT_NAME%', ja.pwa.manifest.shortName),
});

export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/pistol-kamae/' : '/',
  plugins: [
    react(),
    pwaTextPlugin(),
    // devReportPlugin は開発サーバでのみ働く（実機の自動テスト結果をこの Mac に保存する）
    devReportPlugin(),
    // PWA（ホーム画面に追加してアプリのように開ける方式。段階⑦）。
    // マニフェスト（名前・アイコン）と、画面の部品と MediaPipe の wasm・モデルを端末に取り置きするサービスワーカーを作る。
    // 新しい版は勝手に再読込せず、画面に「更新」を出して押してもらう（registerType: 'prompt'。解析の途中を失わないため）。
    // サービスワーカーは公開用ビルドだけで働く（開発サーバでは作らない）
    VitePWA({
      registerType: 'prompt',
      manifest: {
        name: ja.pwa.manifest.name,
        short_name: ja.pwa.manifest.shortName,
        description: ja.pwa.manifest.description,
        lang: 'ja',
        start_url: './',
        scope: './',
        display: 'standalone',
        // 向きは固定しない（iPad で横にして比較画面を見られるように）
        background_color: '#ffffff',
        theme_color: '#ffffff',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          // Android の丸抜き用：図形を中央 80% に収めたもの
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm,task,png,svg,webmanifest}'],
        maximumFileSizeToCacheInBytes: PRECACHE_MAX_BYTES,
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    // 同じ Wi-Fi の iPhone から Mac の IP アドレスで開けるようにする
    host: true,
    fs: {
      // npm workspaces で packages/engine のソースを直接読むため
      allow: ['../..'],
    },
  },
}));
