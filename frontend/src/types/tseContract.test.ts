import { describe, expect, it } from 'vitest';
import { municipioTseSchema, validarVinculoTse, indicadoresEleitoraisSchema, proporcaoTse } from './tseContract';
import { municipioSchema, indicadoresSchema } from './contract';
import { fixtures } from '../test/fixtures';
import { tseFixture, electionIndicators } from '../test/tseFixture';
const census = () => municipioSchema.parse(fixtures['municipios/42/4205407.json']);
describe('contrato sidecar TSE', () => {
  it('mantém zeros e sufixos sem modificar os indicadores do Censo', () => {
    const p = validarVinculoTse(tseFixture(), census());
    expect(p.metadata.cd_mun_tse).toBe('00001');
    expect(p.locais_votacao[0]?.cd_setor_alocado).toBe('420540700000002A');
    expect(indicadoresSchema.safeParse({ ...census().municipio.indicadores, votos_validos: 1 }).success).toBe(false);
  });
  it('valida HALF_EVEN e denominadores zero sem exigir soma exata de proporções arredondadas', () => {
    expect(proporcaoTse(1, 20000)).toBe(0); expect(proporcaoTse(3, 20000)).toBe(.0002);
    expect(proporcaoTse(0, 0)).toBeNull();
    expect(indicadoresEleitoraisSchema.safeParse(electionIndicators(0, 0, 0, 0)).success).toBe(true);
    const zero = tseFixture(); zero.locais_votacao = []; zero.por_agregacao = [];
    zero.resumo_municipio = { ...electionIndicators(0, 0, 0, 0), total_locais: 0, locais_georreferenciados: 0, locais_nao_alocados: 0, cobertura_alocacao_eleitorado: null };
    expect(municipioTseSchema.safeParse(zero).success).toBe(true);
  });
  it('recusa contagens fracionárias/inseguras, campos extras e IDs numéricos sem lançar fora de safeParse', () => {
    for (const change of [
      (p: ReturnType<typeof tseFixture>) => { p.resumo_municipio.comparecimento = 1.5; },
      (p: ReturnType<typeof tseFixture>) => { p.locais_votacao[0]!.indicadores.eleitores_aptos = Number.MAX_SAFE_INTEGER + 1; },
      (p: ReturnType<typeof tseFixture>) => { Object.assign(p.metadata, { cd_mun_tse: 1 }); },
      (p: ReturnType<typeof tseFixture>) => { Object.assign(p.resumo_municipio, { pib: 12 }); },
    ]) { const p = tseFixture(); change(p); expect(municipioTseSchema.safeParse(p).success).toBe(false); }
  });
  it('conserva votos, resumo, alocações, cobertura ponderada, seções e referências', () => {
    for (const change of [
      (p: ReturnType<typeof tseFixture>) => { p.locais_votacao[0]!.indicadores.votos_nominais++; },
      (p: ReturnType<typeof tseFixture>) => { p.resumo_municipio.abstencao_proporcao = .3; },
      (p: ReturnType<typeof tseFixture>) => { Object.assign(p.resumo_municipio, electionIndicators()); p.resumo_municipio.cobertura_alocacao_eleitorado = 1; },
      (p: ReturnType<typeof tseFixture>) => { p.metadata.cd_mun_tse = '00002'; },
      (p: ReturnType<typeof tseFixture>) => { p.resumo_municipio.cobertura_alocacao_eleitorado = .5; },
      (p: ReturnType<typeof tseFixture>) => { p.resumo_municipio.locais_nao_alocados = 0; },
      (p: ReturnType<typeof tseFixture>) => { p.locais_votacao.push(p.locais_votacao[0]!); },
      (p: ReturnType<typeof tseFixture>) => { p.locais_votacao[0]!.nr_zona = '0002'; },
      (p: ReturnType<typeof tseFixture>) => { p.locais_votacao[0]!.id_agregacao_alocada = null; },
      (p: ReturnType<typeof tseFixture>) => { p.locais_votacao[0]!.coordenadas = null; },
      (p: ReturnType<typeof tseFixture>) => { p.por_agregacao[0]!.total_secoes++; },
      (p: ReturnType<typeof tseFixture>) => { p.por_agregacao[0]!.id_locais = ['tse:00001:0001:9999']; },
      (p: ReturnType<typeof tseFixture>) => { p.por_agregacao = []; },
      (p: ReturnType<typeof tseFixture>) => { p.por_agregacao.push(p.por_agregacao[0]!); },
      (p: ReturnType<typeof tseFixture>) => { p.por_agregacao[0]!.indicadores = electionIndicators(50, 40, 3, 2); },
    ]) { const p = structuredClone(tseFixture()); change(p); expect(municipioTseSchema.safeParse(p).success).toBe(false); }
  });
  it('distingue georreferenciado de alocado e rejeita vínculo cruzado setor/grupo', () => {
    const p = tseFixture(); p.locais_votacao[1]!.coordenadas = [0, 0]; p.locais_votacao[1]!.metodo_geo = 'geocodificacao_endereco';
    p.resumo_municipio.locais_georreferenciados = 2;
    expect(municipioTseSchema.safeParse(p).success).toBe(true);
    p.locais_votacao[0]!.cd_setor_alocado = '420540700000004'; // setor oficial, grupo declarado fallback
    expect(() => validarVinculoTse(p, census())).toThrow('setor/grupo');
  });
  it('rejeita recorte de outro município e mistura de proveniência', () => {
    const p = tseFixture(); p.metadata.tipo_dados = 'fonte_tse_declarada';
    expect(() => validarVinculoTse(p, census())).toThrow('base simulada');
    const c = census(); c.metadata.cd_uf = '35';
    expect(() => validarVinculoTse(tseFixture(), c)).toThrow('município selecionado');
  });
});
