// 開発サーバ限定の Vite プラグイン。公開ビルドには一切含まれない（apply: 'serve'）。
//
// 実機（iPhone など）での自動テスト結果を、同じ Wi-Fi 内のこの Mac に保存するためのもの。
//  - GET  /_test/<ファイル名>  apps/web/e2e/videos/ のテスト動画を配信する
//                             （public/ に置くと公開ビルドに混ざるため、開発サーバだけが配信する）
//  - GET  /t                  自動テストの URL へ転送する（実機で入力する URL を短くするため）
//  - POST /__autotest/report  結果（処理時間とノイズの統計値のみ）を受け取り、
//                             apps/web/e2e/results/device-*.json に保存する
//
// 送られてくるのは数値と端末情報（userAgent）だけ。動画とランドマークは受け取らない。

import { createReadStream, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(HERE, 'results');
const VIDEOS_DIR = join(HERE, 'videos');
const VIDEO_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};
const MAX_BODY_BYTES = 1_000_000;

// 1 本目：据銃区間の短いクリップでノイズと速度を測る（再現性を見るため 2 回）
// 2 本目：元の動画（31 秒）を通し、速度の合格ラインを確かめる
const SECOND_RUN = '/?autotest=1&report=1&label=full&video=/_test/sample.mov&start=4.7&end=8.5';
const FIRST_RUN =
  '/?autotest=1&report=1&label=static&video=/_test/static.mp4' +
  '&repeat=2' +
  `&next=${encodeURIComponent(SECOND_RUN)}`;

export function devReportPlugin(): Plugin {
  return {
    name: 'pistol-kamae-dev-report',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/_test', (req, res, next) => {
        // フォルダの外を指せないよう、ファイル名だけを取り出す
        const name = basename(decodeURIComponent((req.url ?? '').split('?')[0] ?? ''));
        const type = VIDEO_TYPES[extname(name).toLowerCase()];
        if (!name || !type) return next();
        const file = join(VIDEOS_DIR, name);
        let size: number;
        try {
          size = statSync(file).size;
        } catch {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', type);
        res.setHeader('Content-Length', String(size));
        createReadStream(file).pipe(res);
      });

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
