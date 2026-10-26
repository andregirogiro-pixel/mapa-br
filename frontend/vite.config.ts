import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { cpSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Serve a mesma árvore particionada em dev e copie-a para a publicação estática.
// Nenhum import/eager glob incorpora detalhes ao bundle inicial.
const dataRoot = resolve(import.meta.dirname, process.env.MAPA_BR_DATA_DIR || '../data/processed');
const prefix = '/data/processed/';
const publicBase = process.env.VITE_BASE_PATH || '/';
let building = false;
export default defineConfig({
  base: publicBase,
  plugins: [react(), {
    name: 'partitioned-data',
    configResolved(config) { building = config.command === 'build'; },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url || '/', 'http://localhost').pathname;
        const matchedPrefix = [`${publicBase.replace(/\/$/, '')}${prefix}`, prefix].find(p => pathname.startsWith(p));
        if (!matchedPrefix) return next();
        const relative = pathname.slice(matchedPrefix.length);
        if (!/^(brasil\.json|uf\/[0-9]{2}\.json|municipios\/[0-9]{2}\/[0-9]{7}\.json)$/.test(relative)) {
          res.statusCode = 404; res.end(); return;
        }
        try {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(readFileSync(resolve(dataRoot, relative)));
        } catch { res.statusCode = 404; res.end(); }
      });
    },
    closeBundle() { if (building) cpSync(dataRoot, resolve(import.meta.dirname, 'dist/data/processed'), { recursive: true }); },
  }],
  test: { include: ['src/**/*.test.{ts,tsx}'], environment: 'jsdom', setupFiles: ['./src/test/setup.ts'], restoreMocks: true },
});
