import { beforeEach, describe, expect, it } from 'vitest';
import { createGeoStore } from './useGeoStore';
import { brasilSchema } from '../types/contract';
import { fixtures } from '../test/fixtures';

beforeEach(() => window.history.replaceState(null, '', '/'));
describe('store geográfica compartilhada', () => {
  function ready() {
    const store = createGeoStore();
    store.getState().registrarRegioes(brasilSchema.parse(fixtures['brasil.json']).ufs.map(u => u.metadata));
    return store;
  }
  it('volta dos cinco níveis e usa a região da UF atual, sem preservar região antiga', () => {
    const store = ready(); const actions = store.getState();
    actions.selecionarRegiao('4'); actions.selecionarUf('35');
    actions.selecionarMunicipio('35', '3550308'); actions.selecionarBairro('subdist:35503080500:urbano');
    actions.voltarNivel();
    expect(store.getState().navigation).toEqual({ level: 'municipio', cd_uf: '35', cd_mun: '3550308' });
    actions.voltarNivel(); expect(store.getState().navigation).toEqual({ level: 'uf', cd_uf: '35' });
    actions.voltarNivel(); expect(store.getState().navigation).toEqual({ level: 'regiao', cd_regiao: '3' });
    actions.voltarNivel(); expect(store.getState().navigation).toEqual({ level: 'pais' });
    expect(window.location.search).toBe('');
  });
  it('limpa descendentes, permite sair do bairro e recusa grupo sem município', () => {
    const store = ready(); const actions = store.getState();
    expect(() => actions.selecionarBairro('grupo')).toThrow();
    actions.selecionarMunicipio('42', '4205407'); actions.selecionarBairro('demo:4205407:grupo-01');
    actions.selecionarBairro(null); expect(store.getState().navigation.level).toBe('municipio');
    actions.selecionarUf('35');
    expect(store.getState().navigation).toEqual({ level: 'uf', cd_uf: '35' });
    expect(window.location.search).not.toMatch(/cd_mun|id_agregacao/);
  });
  it('rejeita IDs numéricos antes de URLSearchParams ou String poderem mascará-los', () => {
    const store = ready(); const actions = store.getState();
    for (const invalid of [42, null, undefined, '4', '4P']) {
      expect(() => actions.selecionarUf(invalid as string)).toThrow();
      expect(store.getState().navigation).toEqual({ level: 'pais' });
      expect(window.location.search).toBe('');
    }
    expect(() => actions.selecionarRegiao(4 as unknown as string)).toThrow();
    expect(() => actions.selecionarMunicipio('35', '4205407')).toThrow();
    expect(() => actions.selecionarUf('35', '4')).toThrow();
  });
  it('lê links profundos e sincroniza histórico mantendo a métrica ativa', () => {
    window.history.replaceState(null, '', '?level=bairro&cd_uf=42&cd_mun=4205407&id_agregacao=demo%3A4205407%3Agrupo-01');
    const store = ready(); const actions = store.getState();
    expect(store.getState().navigation.level).toBe('bairro');
    actions.setMetrica('setores_sob_sigilo');
    window.history.replaceState(null, '', '?level=uf&cd_uf=35'); actions.sincronizarUrl();
    expect(store.getState().navigation).toEqual({ level: 'uf', cd_uf: '35' });
    expect(store.getState().metrica).toBe('setores_sob_sigilo');
    actions.setMetrica('pib_total_bi'); expect(store.getState().metrica).toBe('pib_total_bi');
    window.history.replaceState(null, '', '?level=municipio&cd_uf=35&cd_mun=4205407'); actions.sincronizarUrl();
    expect(store.getState().routeError).not.toBe('');
    expect(store.getState().navigation).toEqual({ level: 'pais' });
  });
});
