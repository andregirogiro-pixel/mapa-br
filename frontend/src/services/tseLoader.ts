import type { FeatureCollection, Point } from 'geojson';
import { DataLoader, DataHttpError } from './dataLoader';
import type { MunicipioPayload } from '../types/contract';
import { validarVinculoTse, type MunicipioTse } from '../types/tseContract';
export async function fetchMunicipioTse(loader: DataLoader, municipality: MunicipioPayload, signal: AbortSignal): Promise<MunicipioTse | null> {
  const { cd_uf, cd_mun } = municipality.metadata;
  const url = new URL(`tse/${cd_uf}/${cd_mun}.json`, loader.indexUrl).href;
  try {
    return validarVinculoTse(await loader.request(url, signal, raw => validarVinculoTse(raw, municipality)), municipality);
  } catch (error) {
    if (error instanceof DataHttpError && error.status === 404) return null;
    throw error;
  }
}
export function pontosTse(payload: MunicipioTse | null | undefined, selected: string | null): FeatureCollection<Point> {
  return { type: 'FeatureCollection', features: (payload?.locais_votacao ?? []).flatMap(loc => loc.coordenadas === null ? [] : [{
    type: 'Feature' as const, id: loc.id_local, geometry: { type: 'Point' as const, coordinates: loc.coordenadas },
    properties: { id_local: loc.id_local, nm_local: loc.nm_local_votacao, grupo: loc.id_agregacao_alocada,
      eleitores_aptos: loc.indicadores.eleitores_aptos, votos_validos: loc.indicadores.votos_validos,
      alocado: loc.cd_setor_alocado !== null, selected: selected !== null && selected === loc.id_agregacao_alocada },
  }]) };
}
