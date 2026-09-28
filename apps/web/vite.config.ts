import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// GitHub Pages では https://<ユーザー名>.github.io/pistol-kamae/ に置かれるため、
// 公開ビルドのときだけパスの先頭を /pistol-kamae/ にする。
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/pistol-kamae/' : '/',
  plugins: [react()],
  server: {
    fs: {
      // npm workspaces で packages/engine のソースを直接読むため
      allow: ['../..'],
    },
  },
}));
