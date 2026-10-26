import { describe, expect, it } from 'vitest';
import { municipioSchema, cdSetorSchema, indicadoresSchema } from '../types/contract';
import { buildSectorToGroupMap, groupForSectorFeature } from './sectorJoin';
import { fixtures } from '../test/fixtures';

describe('contrato e join polimórfico de geometria', () => {
  const municipality = municipioSchema.parse(fixtures['municipios/42/4205407.json']).municipio;
  it('usa a mesma malha de setores para bairro oficial e fallback com cd_bairro null', () => {
    const reverse = buildSectorToGroupMap(municipality.bairros);
    expect(municipality.bairros.some(b => b.cd_bairro === null)).toBe(true);
    for (const bairro of municipality.bairros) {
      for (const cd of bairro.cd_setores) expect(groupForSectorFeature({ CD_SETOR: cd }, reverse)).toBe(bairro.id_agregacao);
    }
    expect(groupForSectorFeature({ CD_SETOR: '420540700000099' }, reverse)).toBeNull();
    expect(() => groupForSectorFeature({ CD_SETOR: 420540700000001 }, reverse)).toThrow();
  });
  it('preserva zeros e sufixos e recusa associação duplicada', () => {
    expect(cdSetorSchema.parse('001234567890123A')).toBe('001234567890123A');
    expect(() => buildSectorToGroupMap([municipality.bairros[0]!, municipality.bairros[0]!])).toThrow();
    expect(() => indicadoresSchema.parse({ ...municipality.indicadores, renda_media: 12 })).toThrow();
  });
});
