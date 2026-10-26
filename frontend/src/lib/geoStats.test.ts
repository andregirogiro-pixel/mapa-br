import { describe, expect, it } from 'vitest';
import type { Feature, Geometry } from 'geojson';
import { criarEscalaCoropletica, calcularBoundingBox, formatarValorIndicador, extrairValorMetrica, metricaDoMapa, COLOR_SIGILO_OU_AUSENTE } from './geoStats';
import { brasilSchema } from '../types/contract';
import { fixtures } from '../test/fixtures';

describe('estatística e apresentação geográfica', () => {
  it('usa quantis para não comprimir todos os valores diante de outliers', () => {
    const values = [0, 1, 2, 3, 4, 1000]; const scale = criarEscalaCoropletica(values);
    expect(new Set(values.map(scale.obterCor)).size).toBe(6);
    expect(scale.min).toBe(0); expect(scale.max).toBe(1000);
    expect(scale.obterCor(null)).toBe(COLOR_SIGILO_OU_AUSENTE);
    expect(scale.obterCor(Infinity)).toBe(COLOR_SIGILO_OU_AUSENTE);
  });
  it('conserva empates e zero e distingue uma escala sem observações', () => {
    const constant = criarEscalaCoropletica([0, 0, null]);
    expect(constant.obterCor(0)).not.toBe(COLOR_SIGILO_OU_AUSENTE);
    const empty = criarEscalaCoropletica([null, undefined, NaN]);
    expect(empty.min).toBeNull(); expect(empty.max).toBeNull();
    expect(empty.obterCor(0)).toBe(COLOR_SIGILO_OU_AUSENTE);
  });
  it('não transforma ausência em sigilo nem em zero e evita cobertura falsamente completa', () => {
    for (const value of [null, undefined, NaN, Infinity]) expect(formatarValorIndicador(value, 'populacao')).toBe('—');
    expect(formatarValorIndicador(0, 'populacao')).toBe('0');
    expect(formatarValorIndicador(.999999, 'cobertura_renda_proporcao')).toBe('< 100%');
    const ind = brasilSchema.parse(fixtures['brasil.json']).resumo_brasil;
    expect(extrairValorMetrica({ ...ind, setores_universo_renda_suprimido: 1 }, 'cobertura_renda_proporcao')).toBeNull();
    expect(extrairValorMetrica({ ...ind, setores_universo_renda_suprimido: 0, responsaveis_renda: 100000, responsaveis_com_renda: 99999, cobertura_renda_proporcao: 1 }, 'cobertura_renda_proporcao')).toBe(.99999);
  });
  it('faz fallback apenas na pintura intramunicipal, preservando PIB no município e UF', () => {
    expect(metricaDoMapa({ level: 'uf', cd_uf: '42' }, 'pib_per_capita')).toBe('pib_per_capita');
    expect(metricaDoMapa({ level: 'municipio', cd_uf: '42', cd_mun: '4205407' }, 'pib_per_capita')).toBe('renda_media_responsavel');
    expect(metricaDoMapa({ level: 'municipio', cd_uf: '42', cd_mun: '4205407' }, 'populacao')).toBe('populacao');
  });
  it('calcula bounding box de geometrias aninhadas, incluindo coleção e nulos', () => {
    const features: Feature<Geometry | null>[] = [{ type: 'Feature', properties: {}, geometry: { type: 'GeometryCollection', geometries: [
      { type: 'MultiPolygon', coordinates: [[[[0, 1], [3, 1], [3, 5], [0, 1]]]] },
      { type: 'Point', coordinates: [-2, -4] },
    ] } }, { type: 'Feature', properties: {}, geometry: null }];
    expect(calcularBoundingBox(features)).toEqual([[-2, -4], [3, 5]]);
    expect(calcularBoundingBox([])).toBeNull();
  });
});
