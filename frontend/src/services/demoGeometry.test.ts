import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { DataLoader } from './dataLoader';
import { loadDemoGeometry } from './demoGeometry';
import { base, fixtureFetcher } from '../test/fixtures';
const geometry = JSON.parse(fs.readFileSync('public/geo/demo/setores/42/4205407.geojson', 'utf8'));

describe('join geométrico estrito', () => {
  it('preserva sufixos e mapeia todos os setores oficiais/fallback ao id universal', async () => {
    const fetcher = fixtureFetcher();
    const loader = new DataLoader(`${base}brasil.json`, fetcher);
    const nav = { level: 'municipio', cd_uf: '42', cd_mun: '4205407' } as const;
    const signal = new AbortController().signal;
    const data = await loader.load(nav, signal);
    fetcher.mockResolvedValue(new Response(JSON.stringify(geometry)));
    const model = await loadDemoGeometry(loader, data, nav, signal);
    expect(model.field).toBe('CD_SETOR');
    expect(model.rowByFeature.get('420540700000002A')).toBe('demo:4205407:grupo-01');
    expect(model.collection.features).toHaveLength(5);
  });
  it('recusa ID numérico, inventário incompleto, setor duplicado e grupo incorreto', async () => {
    for (const mutate of [
      (g: typeof geometry) => { g.features[0].properties.CD_SETOR = 420540700000004; },
      (g: typeof geometry) => { g.features.pop(); },
      (g: typeof geometry) => { g.features.push(g.features[0]); },
      (g: typeof geometry) => { g.features[0].properties.id_agregacao = 'outro'; },
    ]) {
      const fetcher = fixtureFetcher(); const loader = new DataLoader(`${base}brasil.json`, fetcher);
      const nav = { level: 'municipio', cd_uf: '42', cd_mun: '4205407' } as const; const signal = new AbortController().signal;
      const data = await loader.load(nav, signal);
      const bad = structuredClone(geometry); mutate(bad);
      fetcher.mockResolvedValue(new Response(JSON.stringify(bad)));
      await expect(loadDemoGeometry(loader, data, nav, signal)).rejects.toThrow();
    }
  });
});
