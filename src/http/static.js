// public/ (Vite build natijasi) ni tarqatish. SPA: noma'lum yo'l index.html ga.

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export function createStatic(rootDir) {
  const root = resolve(rootDir);

  async function sendFile(res, file, cache) {
    const s = await stat(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Content-Length': s.size,
      'Cache-Control': cache,
    });
    createReadStream(file).pipe(res);
  }

  return async function serve(req, res, pathname) {
    // ".." bilan public/ dan tashqariga chiqib bo'lmasin.
    const rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
    const file = join(root, rel);
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(400).end();
      return;
    }
    try {
      const s = await stat(file);
      if (s.isFile()) {
        // Vite assets/ dagi fayllar nomida xesh bor — ular abadiy keshlanadi;
        // index.html esa har doim yangi bo'lishi kerak, aks holda deploy'dan
        // keyin brauzer eski bundle'ni so'raydi.
        const immutable = rel.startsWith('assets/') || rel.startsWith(`assets${sep}`);
        return sendFile(res, file, immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
      }
    } catch {
      /* fayl yo'q — SPA yo'li */
    }
    // Fayl kengaytmali yo'l topilmasa — haqiqiy 404 (SPA sahifa emas).
    if (extname(rel)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
      return;
    }
    try {
      await sendFile(res, join(root, 'index.html'), 'no-cache');
    } catch {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Frontend build topilmadi. `npm run build` ni bajaring.');
    }
  };
}
