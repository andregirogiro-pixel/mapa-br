import { cdMunSchema, cdRegiaoSchema, cdUfSchema } from '../types/contract';

export type Navigation =
  | { level: 'pais' }
  | { level: 'regiao'; cd_regiao: string }
  | { level: 'uf'; cd_uf: string }
  | { level: 'municipio'; cd_uf: string; cd_mun: string }
  | { level: 'bairro'; cd_uf: string; cd_mun: string; id_agregacao: string };

export function validateNavigation(nav: Navigation): Navigation {
  // A borda das ações valida os valores originais ANTES de URLSearchParams,
  // que converteria números silenciosamente em texto.
  switch (nav.level) {
    case 'pais': return { level: nav.level };
    case 'regiao': return { level: nav.level, cd_regiao: cdRegiaoSchema.parse(nav.cd_regiao) };
    case 'uf': return { level: nav.level, cd_uf: cdUfSchema.parse(nav.cd_uf) };
    case 'municipio': case 'bairro': {
      const cd_uf = cdUfSchema.parse(nav.cd_uf);
      const cd_mun = cdMunSchema.parse(nav.cd_mun);
      if (!cd_mun.startsWith(cd_uf)) throw new Error('Município incompatível com a UF.');
      if (nav.level === 'municipio') return { level: nav.level, cd_uf, cd_mun };
      if (typeof nav.id_agregacao !== 'string' || !nav.id_agregacao.trim()) throw new Error('Identificador de grupo inválido.');
      return { level: nav.level, cd_uf, cd_mun, id_agregacao: nav.id_agregacao };
    }
    default: throw new Error('Nível geográfico inválido.');
  }
}

export function parseNavigation(search: string): Navigation {
  const query = new URLSearchParams(search);
  const level = query.get('level') ?? 'pais';
  if (level === 'pais') return { level };
  if (level === 'regiao') return { level, cd_regiao: cdRegiaoSchema.parse(query.get('cd_regiao')) };
  const cd_uf = cdUfSchema.parse(query.get('cd_uf'));
  if (level === 'uf') return { level, cd_uf };
  const cd_mun = cdMunSchema.parse(query.get('cd_mun'));
  if (!cd_mun.startsWith(cd_uf)) throw new Error('Município incompatível com a UF da URL.');
  if (level === 'municipio') return { level, cd_uf, cd_mun };
  const id_agregacao = query.get('id_agregacao');
  if (level === 'bairro' && id_agregacao) return { level, cd_uf, cd_mun, id_agregacao };
  throw new Error('Navegação inválida.');
}

export function navigationSearch(nav: Navigation): string {
  const clean = validateNavigation(nav);
  if (clean.level === 'pais') return '';
  return `?${new URLSearchParams(clean).toString()}`;
}
