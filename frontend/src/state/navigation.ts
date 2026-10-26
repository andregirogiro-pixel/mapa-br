import { cdMunSchema, cdRegiaoSchema, cdUfSchema } from '../types/contract';

export type Navigation =
  | { level: 'pais' }
  | { level: 'regiao'; cd_regiao: string }
  | { level: 'uf'; cd_uf: string }
  | { level: 'municipio'; cd_uf: string; cd_mun: string }
  | { level: 'bairro'; cd_uf: string; cd_mun: string; id_agregacao: string };

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
  if (nav.level === 'pais') return '';
  return `?${new URLSearchParams(nav).toString()}`;
}
