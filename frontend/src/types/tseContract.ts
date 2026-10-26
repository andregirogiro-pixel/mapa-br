import { z } from 'zod';
import { cdUfSchema, cdMunSchema, cdSetorSchema, type MunicipioPayload } from './contract';
import { buildSectorToGroupMap } from '../services/sectorJoin';

export const cdMunTseSchema = z.string().regex(/^[0-9]{5}$/);
export const nrZonaSchema = z.string().regex(/^[0-9]{4}$/);
export const nrLocalVotacaoSchema = z.string().regex(/^[0-9]{4}$/);
export const idLocalTseSchema = z.string().regex(/^tse:[0-9]{5}:[0-9]{4}:[0-9]{4}$/);
const text = z.string().min(1).refine(s => s.trim().length > 0, 'Texto vazio');
const count = z.number().finite().int().nonnegative().safe();
const proportion = z.number().finite().min(0).max(1).nullable();
export const CAMPOS_CONTAGEM_TSE = ['eleitores_aptos', 'comparecimento', 'abstencao', 'votos_nominais',
  'votos_legenda', 'votos_validos', 'votos_brancos', 'votos_nulos'] as const;
/** Quatro casas decimais, ROUND_HALF_EVEN, sem divisão binária intermediária. */
export function proporcaoTse(numerator: number, denominator: number): number | null {
  count.parse(numerator); count.parse(denominator);
  if (denominator === 0) return null;
  const n = BigInt(numerator) * 10000n, d = BigInt(denominator);
  let q = n / d;
  const remainder = n % d;
  if (remainder * 2n > d || (remainder * 2n === d && q % 2n === 1n)) q += 1n;
  return Number(q) / 10000; // projeção numérica, nunca um ID
}
const indicatorsBase = z.object({
  eleitores_aptos: count, comparecimento: count, abstencao: count,
  votos_nominais: count, votos_legenda: count, votos_validos: count, votos_brancos: count, votos_nulos: count,
  comparecimento_proporcao: proportion, abstencao_proporcao: proportion,
  votos_validos_proporcao: proportion, votos_brancos_proporcao: proportion, votos_nulos_proporcao: proportion,
}).strict();
type Indicators = z.infer<typeof indicatorsBase>;
function issue(ctx: z.RefinementCtx, message: string, path: (string | number)[] = []) {
  ctx.addIssue({ code: 'custom', message, path });
}
function validCounts(ind: Indicators) { return CAMPOS_CONTAGEM_TSE.every(f => Number.isSafeInteger(ind[f]) && ind[f] >= 0); }
function validateIndicators(ind: Indicators, ctx: z.RefinementCtx) {
  if (!validCounts(ind)) return;
  const equal = (parts: number[], target: number) => parts.reduce((a, b) => a + BigInt(b), 0n) === BigInt(target);
  if (!equal([ind.comparecimento, ind.abstencao], ind.eleitores_aptos)) issue(ctx, 'Comparecimento + abstenção difere de aptos');
  if (!equal([ind.votos_nominais, ind.votos_legenda], ind.votos_validos)) issue(ctx, 'Nominais + legenda difere de válidos');
  if (!equal([ind.votos_validos, ind.votos_brancos, ind.votos_nulos], ind.comparecimento)) issue(ctx, 'Válidos + brancos + nulos difere de comparecimento');
  for (const [field, n, d] of [
    ['comparecimento_proporcao', ind.comparecimento, ind.eleitores_aptos],
    ['abstencao_proporcao', ind.abstencao, ind.eleitores_aptos],
    ['votos_validos_proporcao', ind.votos_validos, ind.comparecimento],
    ['votos_brancos_proporcao', ind.votos_brancos, ind.comparecimento],
    ['votos_nulos_proporcao', ind.votos_nulos, ind.comparecimento],
  ] as const) {
    if (ind[field] !== proporcaoTse(n, d)) issue(ctx, 'Proporção incompatível com numerador/denominador (4 casas, HALF_EVEN)', [field]);
  }
}
export const indicadoresEleitoraisSchema = indicatorsBase.superRefine(validateIndicators);
export type IndicadoresEleitorais = z.infer<typeof indicadoresEleitoraisSchema>;
export const metodoGeorreferenciamentoSchema = z.enum(['coordenada_oficial_tse', 'geocodificacao_endereco', 'nao_georreferenciado']);
export const localVotacaoSchema = z.object({
  id_local: idLocalTseSchema, nr_zona: nrZonaSchema, nr_local_votacao: nrLocalVotacaoSchema,
  nm_local_votacao: text, nm_bairro_tse: z.string().nullable(), nr_secoes: count.refine(n => n > 0, 'Número de seções deve ser positivo'),
  metodo_geo: metodoGeorreferenciamentoSchema,
  coordenadas: z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)]).nullable(),
  cd_setor_alocado: cdSetorSchema.nullable(), id_agregacao_alocada: text.nullable(),
  indicadores: indicadoresEleitoraisSchema,
}).strict().superRefine((loc, ctx) => {
  if (loc.id_local.split(':')[2] !== loc.nr_zona || loc.id_local.split(':')[3] !== loc.nr_local_votacao) issue(ctx, 'ID local incompatível com zona/local');
  if ((loc.coordenadas !== null) !== (loc.metodo_geo !== 'nao_georreferenciado')) issue(ctx, 'Método geo incompatível com coordenadas');
  if ((loc.cd_setor_alocado === null) !== (loc.id_agregacao_alocada === null)) issue(ctx, 'Setor e grupo precisam estar ambos alocados ou ambos ausentes');
  if (loc.coordenadas === null && loc.cd_setor_alocado !== null) issue(ctx, 'Local sem coordenadas não pode ter alocação');
});
export type LocalVotacao = z.infer<typeof localVotacaoSchema>;
export const agregacaoEleitoralBairroSchema = z.object({
  id_agregacao: text, metodo_vinculo: z.literal('ponto_local_votacao_no_poligono'),
  total_locais: count, total_secoes: count, id_locais: z.array(idLocalTseSchema), indicadores: indicadoresEleitoraisSchema,
}).strict().superRefine((ag, ctx) => {
  if (ag.total_locais !== ag.id_locais.length || new Set(ag.id_locais).size !== ag.id_locais.length) issue(ctx, 'Lista de locais inconsistente');
});
const summary = indicatorsBase.extend({ total_locais: count, locais_georreferenciados: count,
  locais_nao_alocados: count, cobertura_alocacao_eleitorado: proportion }).strict().superRefine(validateIndicators);
const sum = <T>(items: readonly T[], get: (item: T) => number) => items.reduce((n, item) => n + BigInt(get(item)), 0n);
export const municipioTseSchema = z.object({
  metadata: z.object({ schema_version: z.literal('2.0'), updated_at: z.string().date(), nivel: z.literal('municipio_tse'),
    cd_uf: cdUfSchema, cd_mun: cdMunSchema, cd_mun_tse: cdMunTseSchema, ano_eleicao: z.number().int().safe(),
    nr_turno: z.union([z.literal(1), z.literal(2)]), cargo: text, aviso_metodologico: text,
    tipo_dados: z.enum(['simulados', 'fonte_tse_declarada']).default('fonte_tse_declarada'),
  }).strict(),
  resumo_municipio: summary, locais_votacao: z.array(localVotacaoSchema), por_agregacao: z.array(agregacaoEleitoralBairroSchema),
}).strict().superRefine((p, ctx) => {
  const { cd_uf, cd_mun, cd_mun_tse } = p.metadata, ind = p.resumo_municipio;
  if (!validCounts(ind) || p.locais_votacao.some(l => !validCounts(l.indicadores) || !Number.isSafeInteger(l.nr_secoes)) ||
      p.por_agregacao.some(a => !validCounts(a.indicadores) || !Number.isSafeInteger(a.total_secoes))) return;
  if (!cd_mun.startsWith(cd_uf)) issue(ctx, 'Município IBGE fora da UF');
  const locals = new Map<string, LocalVotacao>();
  for (const [i, loc] of p.locais_votacao.entries()) {
    if (!loc.id_local.startsWith(`tse:${cd_mun_tse}:`) || locals.has(loc.id_local)) issue(ctx, 'Local duplicado ou fora do município TSE', ['locais_votacao', i]);
    if (loc.cd_setor_alocado !== null && !loc.cd_setor_alocado.startsWith(cd_mun)) issue(ctx, 'Setor fora do município IBGE', ['locais_votacao', i, 'cd_setor_alocado']);
    locals.set(loc.id_local, loc);
  }
  for (const field of CAMPOS_CONTAGEM_TSE) {
    if (sum(p.locais_votacao, loc => loc.indicadores[field]) !== BigInt(ind[field])) issue(ctx, 'Resumo diverge da soma dos locais', ['resumo_municipio', field]);
  }
  if (ind.total_locais !== p.locais_votacao.length) issue(ctx, 'Total de locais divergente');
  if (ind.locais_georreferenciados !== p.locais_votacao.filter(l => l.coordenadas !== null).length) issue(ctx, 'Contagem georreferenciada divergente');
  if (ind.locais_nao_alocados !== p.locais_votacao.filter(l => l.cd_setor_alocado === null).length) issue(ctx, 'Contagem não alocada divergente');
  const allocated = sum(p.locais_votacao.filter(l => l.cd_setor_alocado !== null), l => l.indicadores.eleitores_aptos);
  if (allocated > BigInt(ind.eleitores_aptos) || ind.cobertura_alocacao_eleitorado !== proporcaoTse(Number(allocated), ind.eleitores_aptos)) issue(ctx, 'Cobertura deve ser ponderada pelos aptos alocados');
  const groups = new Set<string>(), assigned = new Set<string>();
  for (const [i, ag] of p.por_agregacao.entries()) {
    if (groups.has(ag.id_agregacao)) issue(ctx, 'Agrupamento duplicado', ['por_agregacao', i]);
    groups.add(ag.id_agregacao);
    const members: LocalVotacao[] = [];
    for (const id of ag.id_locais) {
      const loc = locals.get(id);
      if (!loc || assigned.has(id) || loc.id_agregacao_alocada !== ag.id_agregacao || loc.cd_setor_alocado === null) issue(ctx, 'Referência local ausente, duplicada ou fora do grupo', ['por_agregacao', i, 'id_locais']);
      if (loc) members.push(loc);
      assigned.add(id);
    }
    if (sum(members, l => l.nr_secoes) !== BigInt(ag.total_secoes)) issue(ctx, 'Total de seções do grupo divergente', ['por_agregacao', i]);
    for (const field of CAMPOS_CONTAGEM_TSE) if (sum(members, l => l.indicadores[field]) !== BigInt(ag.indicadores[field])) issue(ctx, 'Totais do grupo divergem dos locais', ['por_agregacao', i, 'indicadores', field]);
  }
  for (const loc of p.locais_votacao) if (loc.cd_setor_alocado !== null && !assigned.has(loc.id_local)) issue(ctx, 'Local alocado ausente das agregações');
});
export type MunicipioTse = z.infer<typeof municipioTseSchema>;
/** Integridade referencial; não comprova contenção espacial ou qualidade do geocoding. */
export function validarVinculoTse(raw: unknown, municipality: MunicipioPayload): MunicipioTse {
  const p = municipioTseSchema.parse(raw);
  if (p.metadata.cd_uf !== municipality.metadata.cd_uf || p.metadata.cd_mun !== municipality.municipio.cd_mun) throw new Error('Sidecar TSE fora do município selecionado');
  if ((p.metadata.tipo_dados === 'simulados') !== (municipality.metadata.tipo_dados === 'simulados')) throw new Error('Não misturar sidecar real e base simulada, ou vice-versa');
  const reverse = buildSectorToGroupMap(municipality.municipio.bairros);
  const groups = new Set(municipality.municipio.bairros.map(b => b.id_agregacao));
  for (const loc of p.locais_votacao) if (loc.cd_setor_alocado !== null && reverse.get(loc.cd_setor_alocado) !== loc.id_agregacao_alocada) throw new Error('Vínculo TSE setor/grupo incompatível com o Censo');
  for (const ag of p.por_agregacao) if (!groups.has(ag.id_agregacao)) throw new Error('Grupo eleitoral ausente do município IBGE');
  return p;
}
