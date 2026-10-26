import { z } from 'zod';
import type { FeatureCollection, Polygon } from 'geojson';
import { DataLoader, type LoadedData } from './dataLoader';
import { buildSectorToGroupMap } from './sectorJoin';
import { cdSetorSchema, cdUfSchema, cdMunSchema } from '../types/contract';
import type { Navigation } from '../state/navigation';

const point = z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)]);
const ring = z.array(point).min(4).refine(p => p[0]![0] === p.at(-1)![0] && p[0]![1] === p.at(-1)![1], 'Anel aberto');
const collectionSchema = z.object({ type: z.literal('FeatureCollection'), demo: z.literal(true),
  features: z.array(z.object({ type: z.literal('Feature'), properties: z.record(z.unknown()),
    geometry: z.object({ type: z.literal('Polygon'), coordinates: z.array(ring).min(1) }) })).min(1),
});
export interface DemoGeometry { collection: FeatureCollection<Polygon>; field: string; rowByFeature: Map<string, string> }
export async function loadDemoGeometry(loader: DataLoader, data: LoadedData, nav: Navigation, signal: AbortSignal): Promise<DemoGeometry> {
  if (data.index.metadata.tipo_dados !== 'simulados') throw new Error('Geometria sintética exige fixtures simuladas.');
  const municipal = nav.level === 'municipio' || nav.level === 'bairro';
  const state = nav.level === 'uf' && data.uf;
  const field = municipal ? 'CD_SETOR' : state ? 'cd_mun' : 'cd_uf';
  const file = municipal ? `setores/${nav.cd_uf}/${nav.cd_mun}.geojson` : state ? `municipios/${nav.cd_uf}.geojson` : 'ufs.geojson';
  const root = new URL(`${import.meta.env.BASE_URL}geo/demo/`, document.baseURI);
  const parsed = collectionSchema.parse(await loader.request(new URL(file, root).href, signal, raw => collectionSchema.parse(raw)));
  const expected = municipal ? buildSectorToGroupMap(data.municipio!.municipio.bairros) :
    new Map((state ? data.uf!.municipios_resumo.map(m => m.cd_mun) : data.index.ufs.map(u => u.metadata.cd_uf)).map(code => [code, code]));
  const seen = new Set<string>();
  for (const f of parsed.features) {
    const code = (municipal ? cdSetorSchema : state ? cdMunSchema : cdUfSchema).parse(f.properties[field]);
    if (seen.has(code) || !expected.has(code)) throw new Error('Geometria duplicada ou sem vínculo tabular.');
    if (municipal && (f.properties.cd_mun !== nav.cd_mun || f.properties.id_agregacao !== expected.get(code))) throw new Error('Setor incompatível com município/grupo.');
    if (!municipal && !state && f.properties.cd_regiao !== data.index.ufs.find(u => u.metadata.cd_uf === code)?.metadata.cd_regiao) throw new Error('UF geométrica fora da região declarada.');
    if (municipal) {
      const group = data.municipio!.municipio.bairros.find(b => b.id_agregacao === expected.get(code))!;
      if (f.properties.cd_bairro !== group.cd_bairro || f.properties.origem_malha !== group.origem_malha) throw new Error('Malha incompatível com o grupo.');
    }
    if (state && f.properties.cd_uf !== nav.cd_uf) throw new Error('Município geométrico fora da UF.');
    seen.add(code);
  }
  if (seen.size !== expected.size) throw new Error('Inventários geométrico e tabular diferentes.');
  const features = parsed.features.filter(f => nav.level === 'regiao' ? f.properties.cd_regiao === nav.cd_regiao :
    nav.level === 'uf' && !state ? f.properties.cd_uf === nav.cd_uf : true);
  if (!features.length) throw new Error('Sem geometria para o recorte.');
  return { collection: { type: 'FeatureCollection', features }, field, rowByFeature: expected };
}
