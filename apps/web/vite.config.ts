import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const fileURLToPath = (url: URL): string => decodeURIComponent(url.pathname);

// GitHub Pages では https://<ユーザー名>.github.io/pistol-kamae/ に置かれるため、
// 公開ビルドのときだけパスの先頭を /pistol-kamae/ にする。
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/pistol-kamae/' : '/',
  plugins: [react()],
  resolve: {
    alias: {
      // 使わない BlazePose 用の依存を空の代替に差し替える（engine/shims を参照）
      '@mediapipe/pose': fileURLToPath(
        new URL('../../packages/engine/shims/mediapipe-pose-stub.js', import.meta.url),
      ),
    },
  },
  server: {
    fs: {
      // npm workspaces で packages/engine のソースを直接読むため
      allow: ['../..'],
    },
  },
}));
