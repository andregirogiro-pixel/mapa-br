import { describe, expect, it } from 'vitest';
import { DataLoader } from './dataLoader';
import { fetchMunicipioTse, pontosTse } from './tseLoader';
import { municipioSchema } from '../types/contract';
import { base, fixtureFetcher, fixtures } from '../test/fixtures';
import { tseFixture } from '../test/tseFixture';
const census = () => municipioSchema.parse(fixtures['municipios/42/4205407.json']);
describe('carga opcional TSE', () => {
  it('resolve abaixo da raiz do índice e usa cache validado', async () => {
    const fetcher = fixtureFetcher(); fetcher.mockResolvedValue(new Response(JSON.stringify(tseFixture())));
    const loader = new DataLoader(`${base}brasil.json`, fetcher), signal = new AbortController().signal;
    const p = await fetchMunicipioTse(loader, census(), signal);
    await fetchMunicipioTse(loader, census(), signal);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe(`${base}tse/42/4205407.json`);
    const points = pontosTse(p, 'demo:4205407:grupo-01');
    expect(points.features).toHaveLength(1); expect(points.features[0]?.properties?.selected).toBe(true);
    expect(points.features[0]?.id).toBe('tse:00001:0001:0001');
  });
  it('trata apenas 404 como indisponibilidade, não mascara erro HTTP ou contrato', async () => {
    const fetcher = fixtureFetcher(), loader = new DataLoader(`${base}brasil.json`, fetcher), signal = new AbortController().signal;
    expect(await fetchMunicipioTse(loader, census(), signal)).toBeNull();
    fetcher.mockResolvedValueOnce(new Response('{}', { status: 503 }));
    await expect(fetchMunicipioTse(loader, census(), signal)).rejects.toThrow('503');
    fetcher.mockResolvedValueOnce(new Response('{}'));
    await expect(fetchMunicipioTse(loader, census(), signal)).rejects.toThrow();
  });
});
