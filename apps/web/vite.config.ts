import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { devReportPlugin } from './e2e/devReportPlugin';

// GitHub Pages では https://<ユーザー名>.github.io/pistol-kamae/ に置かれるため、
// 公開ビルドのときだけパスの先頭を /pistol-kamae/ にする。
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/pistol-kamae/' : '/',
  // devReportPlugin は開発サーバでのみ働く（実機の自動テスト結果をこの Mac に保存する）
  plugins: [react(), devReportPlugin()],
  resolve: {
    alias: {
      // 使わない BlazePose 用の依存を空の代替に差し替える（engine/shims を参照）
      '@mediapipe/pose': fileURLToPath(
        new URL('../../packages/engine/shims/mediapipe-pose-stub.js', import.meta.url),
      ),
    },
  },
  server: {
    // 同じ Wi-Fi の iPhone から Mac の IP アドレスで開けるようにする
    host: true,
    fs: {
      // npm workspaces で packages/engine のソースを直接読むため
      allow: ['../..'],
    },
  },
}));
