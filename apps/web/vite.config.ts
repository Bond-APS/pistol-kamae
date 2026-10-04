import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { devReportPlugin } from './e2e/devReportPlugin';

// GitHub Pages では https://<ユーザー名>.github.io/pistol-kamae/ に置かれるため、
// 公開ビルドのときだけパスの先頭を /pistol-kamae/ にする。
// ビルド結果の確認（npm run preview）も同じ先頭にする（そうしないと、ビルドしたファイルを読めず画面が出ない）。
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/pistol-kamae/' : '/',
  // devReportPlugin は開発サーバでのみ働く（実機の自動テスト結果をこの Mac に保存する）
  plugins: [react(), devReportPlugin()],
  server: {
    // 同じ Wi-Fi の iPhone から Mac の IP アドレスで開けるようにする
    host: true,
    fs: {
      // npm workspaces で packages/engine のソースを直接読むため
      allow: ['../..'],
    },
  },
}));
