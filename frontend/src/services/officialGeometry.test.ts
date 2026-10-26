import { describe, expect, it, vi } from 'vitest';
import { DataLoader } from './dataLoader';
import { loadOfficialCartography, officialCollectionSchema, validateInventory } from './officialGeometry';
const root = 'https://local.test/prefix/geo/official/';
const ring = [[-49, -28], [-48, -28], [-48, -27], [-49, -28]];
const props = { cd_uf: '42', cd_regiao: '4', nm_uf: 'Santa Catarina', sigla_uf: 'SC' };
function collection(p: Record<string, unknown> = props) { return { type: 'FeatureCollection', referencia: 'Censo 2022', features: [{ type: 'Feature', properties: p, geometry: { type: 'MultiPolygon', coordinates: [[ring]] } }] }; }
function fixture() {
  const catalog = { schema_version: 'cartografia-1', referencia: 'Censo 2022', estatisticas: 'indisponiveis',
    ufs: { arquivo: 'ufs.geojson', inventario: 'ufs.inventory.json' }, municipios: { '42': { arquivo: 'municipios/42.geojson', inventario: 'municipios/42.inventory.json' } },
    setores: { '4205407': { arquivo: '../setores/42/4205407.geojson', inventario: '../setores/42/4205407.inventory.json' } } };
  const files: Record<string, unknown> = { 'catalogo.json': catalog, 'ufs.geojson': collection(),
    'ufs.inventory.json': { ids: ['42'] }, 'municipios/42.inventory.json': { ids: ['4205407'] },
    'setores/42/4205407.inventory.json': { ids: ['420540705000001'] },
    'municipios/42.geojson': collection({ ...props, cd_mun: '4205407', nm_mun: 'Florianópolis' }),
    'setores/42/4205407.geojson': collection({ ...props, cd_mun: '4205407', nm_mun: 'Florianópolis', cd_setor: '420540705000001' }) };
  const fetcher = vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(files[new URL(input.toString()).href.slice(root.length)]), { status: 200 }));
  return { fetcher, loader: new DataLoader(root + 'catalogo.json', fetcher as typeof fetch) };
}
describe('cartografia oficial independente de estatísticas', () => {
  it('carrega progressivamente, resolve setores pelo arquivo da UF e reutiliza o cache', async () => {
    const { loader, fetcher } = fixture(); const signal = new AbortController().signal;
    const country = await loadOfficialCartography(loader, { level: 'pais' }, signal);
    expect(country.kind).toBe('cartografia'); expect(country.statistics.status).toBe('indisponiveis');
    expect(country).not.toHaveProperty('index'); expect(fetcher).toHaveBeenCalledTimes(3);
    await loadOfficialCartography(loader, { level: 'uf', cd_uf: '42' }, signal); expect(fetcher).toHaveBeenCalledTimes(5);
    const state = await loadOfficialCartography(loader, { level: 'setor', cd_uf: '42', cd_mun: '4205407', cd_setor: '420540705000001' }, signal);
    expect(state.geometry.field).toBe('cd_setor'); expect(fetcher.mock.calls.map(c => c[0])).toContain(root + 'setores/42/4205407.geojson');
    await loadOfficialCartography(loader, { level: 'uf', cd_uf: '42' }, signal); expect(fetcher).toHaveBeenCalledTimes(7);
  });
  it('rejeita IDs numéricos, duplicatas, inventário incompleto e pertencimento divergente', () => {
    const parsed = officialCollectionSchema.parse(collection());
    expect(() => officialCollectionSchema.parse(collection({ ...props, cd_uf: 42 }))).toThrow();
    expect(() => validateInventory({ ...parsed, features: [...parsed.features, ...parsed.features] }, 'cd_uf', ['42'], { level: 'pais' })).toThrow(/duplicada/);
    expect(() => validateInventory(parsed, 'cd_uf', ['42', '35'], { level: 'pais' })).toThrow(/ausentes/);
    const outside = officialCollectionSchema.parse(collection({ ...props, cd_uf: '35', cd_mun: '4205407' }));
    expect(() => validateInventory(outside, 'cd_mun', ['4205407'], { level: 'uf', cd_uf: '42' })).toThrow(/UF/);
  });
  it('recusa setores e bairros fora do inventário sem substituir por dados simulados', async () => {
    const { loader } = fixture(); const signal = new AbortController().signal;
    await expect(loadOfficialCartography(loader, { level: 'setor', cd_uf: '42', cd_mun: '4205407', cd_setor: '420540705999999' }, signal)).rejects.toThrow(/fora do inventário/);
    await expect(loadOfficialCartography(loader, { level: 'bairro', cd_uf: '42', cd_mun: '4205407', id_agregacao: 'demo:grupo' }, signal)).rejects.toThrow(/não auditada/);
  });
});
