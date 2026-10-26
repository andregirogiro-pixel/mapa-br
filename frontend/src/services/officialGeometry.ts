import { z } from 'zod';
import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import { DataLoader } from './dataLoader';
import type { MapGeometry } from '../types/geometry';
import { cdUfSchema, cdMunSchema, cdSetorSchema } from '../types/contract';
import { validateNavigation, type Navigation } from '../state/navigation';

const asset = z.object({ arquivo: z.string().min(1), inventario: z.string().min(1) }).strict();
const inventorySchema = z.object({ ids: z.array(z.string()).min(1) }).strict();
export const catalogSchema = z.object({
  schema_version: z.literal('cartografia-1'), referencia: z.literal('Censo 2022'),
  estatisticas: z.literal('indisponiveis'), ufs: asset,
  municipios: z.record(asset), setores: z.record(asset),
}).strict();
export type OfficialCatalog = z.infer<typeof catalogSchema>;
const point = z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)]);
const ring = z.array(point).min(4).refine(p => p[0]![0] === p.at(-1)![0] && p[0]![1] === p.at(-1)![1], 'Anel aberto');
const polygon = z.array(ring).min(1);
export const officialCollectionSchema = z.object({
  type: z.literal('FeatureCollection'), referencia: z.literal('Censo 2022'),
  features: z.array(z.object({ type: z.literal('Feature'), properties: z.object({
    cd_uf: cdUfSchema, cd_regiao: z.string().regex(/^[1-5]$/), nm_uf: z.string(), sigla_uf: z.string(),
    cd_mun: cdMunSchema.optional(), nm_mun: z.string().optional(), cd_setor: cdSetorSchema.optional(),
  }).strict(), geometry: z.discriminatedUnion('type', [
    z.object({ type: z.literal('Polygon'), coordinates: polygon }),
    z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(polygon).min(1) }),
  ]) })).min(1),
}).strict();
export type OfficialCollection = z.infer<typeof officialCollectionSchema>;
export interface CartographyState {
  kind: 'cartografia'; statistics: { status: 'indisponiveis' };
  country: OfficialCollection; geometry: MapGeometry; title: string;
  unavailableGeometry?: string;
}
export function validateInventory(collection: OfficialCollection, field: 'cd_uf' | 'cd_mun' | 'cd_setor', ids: string[], nav: Navigation) {
  const expected = new Set(ids), seen = new Set<string>();
  if (expected.size !== ids.length) throw new Error('Inventário oficial duplicado no catálogo.');
  for (const f of collection.features) {
    const code = f.properties[field];
    if (!code || seen.has(code) || !expected.has(code)) throw new Error('Geometria oficial duplicada ou fora do inventário auditado.');
    if (field !== 'cd_uf' && 'cd_uf' in nav && f.properties.cd_uf !== nav.cd_uf) throw new Error('Geometria fora da UF selecionada.');
    if (field === 'cd_mun' && !code.startsWith(f.properties.cd_uf)) throw new Error('Município incompatível com a UF.');
    if (field === 'cd_setor' && ('cd_mun' in nav && f.properties.cd_mun !== nav.cd_mun || !code.startsWith(f.properties.cd_mun!))) throw new Error('Setor fora do município selecionado.');
    seen.add(code);
  }
  if (seen.size !== expected.size) throw new Error('Inventários cartográficos incompatíveis: há identificadores ausentes.');
}
function geometry(collection: OfficialCollection, field: 'cd_uf' | 'cd_mun' | 'cd_setor'): MapGeometry {
  return { collection: collection as FeatureCollection<Polygon | MultiPolygon>, field,
    rowByFeature: new Map(collection.features.map(f => [f.properties[field]!, f.properties[field]!])) };
}
export async function loadOfficialCartography(loader: DataLoader, nav: Navigation, signal: AbortSignal): Promise<CartographyState> {
  validateNavigation(nav);
  const catalog = catalogSchema.parse(await loader.request(loader.indexUrl, signal, raw => catalogSchema.parse(raw)));
  const read = async (entry: z.infer<typeof asset>, field: 'cd_uf' | 'cd_mun' | 'cd_setor', parent = loader.indexUrl) => {
    const url = loader.resolve(entry.arquivo, parent);
    const inventoryUrl = loader.resolve(entry.inventario, parent);
    const [collection, inventory] = await Promise.all([
      loader.request(url, signal, raw => officialCollectionSchema.parse(raw)).then(raw => officialCollectionSchema.parse(raw)),
      loader.request(inventoryUrl, signal, raw => inventorySchema.parse(raw)).then(raw => inventorySchema.parse(raw)),
    ]);
    validateInventory(collection, field, inventory.ids, nav); return { collection, url };
  };
  const { collection: country } = await read(catalog.ufs, 'cd_uf');
  const state = (collection: OfficialCollection, field: 'cd_uf' | 'cd_mun' | 'cd_setor', title: string, unavailableGeometry?: string): CartographyState =>
    ({ kind: 'cartografia', statistics: { status: 'indisponiveis' }, country, geometry: geometry(collection, field), title, unavailableGeometry });
  if (nav.level === 'pais') return state(country, 'cd_uf', 'Brasil');
  if (nav.level === 'regiao') {
    const features = country.features.filter(f => f.properties.cd_regiao === nav.cd_regiao);
    if (!features.length) throw new Error('Região fora do inventário oficial.');
    const names: Record<string, string> = { '1': 'Norte', '2': 'Nordeste', '3': 'Sudeste', '4': 'Sul', '5': 'Centro-Oeste' };
    return state({ ...country, features }, 'cd_uf', names[nav.cd_regiao]!);
  }
  const uf = country.features.find(f => f.properties.cd_uf === nav.cd_uf);
  if (!uf) throw new Error('UF fora do inventário oficial.');
  const municipalEntry = catalog.municipios[nav.cd_uf];
  if (!municipalEntry) {
    if (nav.level !== 'uf') throw new Error('Geometria municipal indisponível para esta UF nesta entrega.');
    return state({ ...country, features: [uf] }, 'cd_uf', uf.properties.nm_uf, 'Geometria municipal indisponível para esta UF nesta entrega.');
  }
  const { collection: municipalities, url: ufUrl } = await read(municipalEntry, 'cd_mun');
  if (nav.level === 'uf') return state(municipalities, 'cd_mun', uf.properties.nm_uf);
  const municipality = municipalities.features.find(f => f.properties.cd_mun === nav.cd_mun);
  if (!municipality) throw new Error('Município fora do inventário desta UF.');
  if (nav.level === 'bairro') throw new Error('Correspondência com bairros não auditada. Selecione um setor censitário.');
  const sectorsEntry = catalog.setores[nav.cd_mun];
  if (!sectorsEntry) {
    if (nav.level === 'setor') throw new Error('Geometria setorial indisponível para este município nesta entrega.');
    return state({ ...municipalities, features: [municipality] }, 'cd_mun', municipality.properties.nm_mun!, 'Geometria setorial indisponível para este município nesta entrega.');
  }
  // O caminho setorial é relativo ao arquivo da UF, como nos dados existentes.
  const { collection: sectors } = await read(sectorsEntry, 'cd_setor', ufUrl);
  if (nav.level === 'setor' && !sectors.features.some(f => f.properties.cd_setor === nav.cd_setor)) throw new Error('Setor fora do inventário deste município.');
  return state(sectors, 'cd_setor', nav.level === 'setor' ? `Setor ${nav.cd_setor}` : municipality.properties.nm_mun!);
}
