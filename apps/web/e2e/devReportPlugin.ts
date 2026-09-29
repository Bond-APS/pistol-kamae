// 開発サーバ限定の Vite プラグイン。公開ビルドには一切含まれない（apply: 'serve'）。
//
// 実機（iPhone など）での自動テスト結果を、同じ Wi-Fi 内のこの Mac に保存するためのもの。
//  - GET  /t                  自動テストの URL へ転送する（実機で入力する URL を短くするため）
//  - POST /__autotest/report  結果（処理時間とノイズの統計値のみ）を受け取り、
//                             apps/web/e2e/results/device-*.json に保存する
//
// 送られてくるのは数値と端末情報（userAgent）だけ。動画とランドマークは受け取らない。

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const RESULTS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'results');
const MAX_BODY_BYTES = 1_000_000;

// 1 本目：据銃区間の短いクリップで全モデルのノイズと速度を測る
// 2 本目：元の動画（31 秒）を既定モデルで通し、速度の合格ラインを確かめる
const SECOND_RUN =
  '/?autotest=1&report=1&label=full&video=/_test/sample.mov&start=4.7&end=8.5' +
  '&backends=mediapipeFullVideo';
const FIRST_RUN =
  '/?autotest=1&report=1&label=static&video=/_test/static.mp4' +
  '&backends=mediapipeFullVideo,mediapipeLiteVideo,mediapipeHeavyVideo,mediapipeFullImage,movenetThunder' +
  `&next=${encodeURIComponent(SECOND_RUN)}`;

export function devReportPlugin(): Plugin {
  return {
    name: 'pistol-kamae-dev-report',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/t', (req, res, next) => {
        if (req.url !== '/' && req.url !== '') return next();
        res.statusCode = 302;
        res.setHeader('Location', FIRST_RUN);
        res.end();
      });

      server.middlewares.use('/__autotest/report', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            res.statusCode = 413;
            res.end();
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        req.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
              label?: unknown;
              sessionId?: unknown;
            };
            const safe = (v: unknown) => String(v ?? '').replace(/[^A-Za-z0-9_-]/g, '');
            const name = `device-${safe(body.sessionId)}-${safe(body.label) || 'run'}.json`;
            mkdirSync(RESULTS_DIR, { recursive: true });
            writeFileSync(join(RESULTS_DIR, name), JSON.stringify(body, null, 2));
            server.config.logger.info(`[autotest] saved ${name}`);
            res.statusCode = 204;
          } catch {
            res.statusCode = 400;
          }
          res.end();
        });
      });
    },
  };
}
