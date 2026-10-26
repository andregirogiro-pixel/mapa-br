import { describe, expect, it } from 'vitest';
import { navigationSearch, parseNavigation } from './navigation';
import type { Navigation } from './navigation';

describe('navegação discriminada', () => {
  it('faz round-trip dos cinco níveis sem converter IDs', () => {
    const states: Navigation[] = [ { level: 'pais' }, { level: 'regiao', cd_regiao: '4' },
      { level: 'uf', cd_uf: '42' }, { level: 'municipio', cd_uf: '42', cd_mun: '4205407' },
      { level: 'bairro', cd_uf: '42', cd_mun: '4205407', id_agregacao: 'subdist:42054070100:urbano / área 1' } ];
    for (const nav of states) expect(parseNavigation(navigationSearch(nav))).toEqual(nav);
  });
  it('descarta descendentes ao mudar para UF e recusa combinação impossível', () => {
    expect(navigationSearch({ level: 'uf', cd_uf: '35' })).not.toContain('cd_mun');
    expect(() => parseNavigation('?level=municipio&cd_uf=35&cd_mun=4205407')).toThrow();
    expect(() => parseNavigation('?level=uf&cd_uf=4')).toThrow();
    expect(() => parseNavigation('?level=bairro&cd_uf=42&cd_mun=4205407')).toThrow();
  });
});
