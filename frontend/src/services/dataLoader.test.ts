import { describe, expect, it, vi } from 'vitest';
import { DataLoader } from './dataLoader';
import { base, fixtureFetcher, fixtures } from '../test/fixtures';

describe('URLs, cache e cancelamento', () => {
  it('resolve municípios em relação ao arquivo UF, inclusive em um subdiretório de publicação', async () => {
    const fetcher = fixtureFetcher(); const loader = new DataLoader(`${base}brasil.json`, fetcher);
    const data = await loader.load({ level: 'municipio', cd_uf: '42', cd_mun: '4205407' }, new AbortController().signal);
    expect(data.municipio?.municipio.cd_mun).toBe('4205407');
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      `${base}brasil.json`, `${base}uf/42.json`, `${base}municipios/42/4205407.json`,
    ]);
  });
  it('carrega apenas o índice inicialmente e somente os resumos ao selecionar UF', async () => {
    const fetcher = fixtureFetcher(); const loader = new DataLoader(`${base}brasil.json`, fetcher);
    await loader.load({ level: 'pais' }, new AbortController().signal);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await loader.load({ level: 'uf', cd_uf: '42' }, new AbortController().signal);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await loader.load({ level: 'uf', cd_uf: '12' }, new AbortController().signal);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await loader.load({ level: 'uf', cd_uf: '42' }, new AbortController().signal);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('compartilha uma request pendente sem cancelar o outro consumidor', async () => {
    let release!: (value: Response) => void;
    const fetcher = vi.fn<typeof fetch>(() => new Promise(resolve => { release = resolve; }));
    const loader = new DataLoader(`${base}brasil.json`, fetcher);
    const one = new AbortController(); const two = new AbortController();
    const first = loader.load({ level: 'pais' }, one.signal);
    const firstOutcome = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    const second = loader.load({ level: 'pais' }, two.signal);
    one.abort();
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    release(new Response(JSON.stringify(fixtures['brasil.json'])));
    await firstOutcome;
    expect((await second).index.ufs).toHaveLength(27);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('aborta o transporte quando não há consumidores e permite nova tentativa', async () => {
    const fetcher = vi.fn<typeof fetch>((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('cancel', 'AbortError')));
    }));
    const loader = new DataLoader(`${base}brasil.json`, fetcher); const controller = new AbortController();
    const result = loader.load({ level: 'pais' }, controller.signal);
    const outcome = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await outcome;
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    fetcher.mockImplementation(fixtureFetcher());
    expect((await loader.load({ level: 'pais' }, new AbortController().signal)).index.ufs).toHaveLength(27);
  });
  it('não mantém falhas HTTP ou JSON incompatível no cache', async () => {
    const fetcher = fixtureFetcher(); fetcher.mockResolvedValueOnce(new Response('{}', { status: 503 }));
    const loader = new DataLoader(`${base}brasil.json`, fetcher);
    await expect(loader.load({ level: 'pais' }, new AbortController().signal)).rejects.toThrow('503');
    fetcher.mockResolvedValueOnce(new Response('{}'));
    await expect(loader.load({ level: 'pais' }, new AbortController().signal)).rejects.toThrow();
    expect((await loader.load({ level: 'pais' }, new AbortController().signal)).index.ufs).toHaveLength(27);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('recusa município fora da UF, grupo inexistente e dado fora do recorte', async () => {
    const loader = new DataLoader(`${base}brasil.json`, fixtureFetcher());
    for (const nav of [
      { level: 'municipio', cd_uf: '42', cd_mun: '3550308' },
      { level: 'municipio', cd_uf: '12', cd_mun: '1200401' },
      { level: 'bairro', cd_uf: '42', cd_mun: '4205407', id_agregacao: 'desconhecido' },
    ] as const) await expect(loader.load(nav, new AbortController().signal)).rejects.toThrow();
  });
});
