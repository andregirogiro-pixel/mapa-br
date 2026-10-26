import { z } from 'zod';

export type CdRegiao = string;
export type CdUf = string;
export type CdMun = string;
export type CdBairro = string;
export type CdSetor = string;
export const cdRegiaoSchema = z.string().regex(/^[1-5]$/);
export const cdUfSchema = z.string().regex(/^[0-9]{2}$/);
export const cdMunSchema = z.string().regex(/^[0-9]{7}$/);
export const cdBairroSchema = z.string().regex(/^[0-9]{9,10}$/);
export const cdSetorSchema = z.string().regex(/^[0-9]{15}[A-Z]?$/);
const count = z.number().int().nonnegative().nullable();
const amount = z.number().finite().nonnegative().nullable();
const decimal = z.string().regex(/^[0-9]+(?:\.[0-9]+)?$/).nullable();
export const indicadoresSchema = z.object({
  populacao: z.number().int().nonnegative(),
  pib_mil_reais: amount,
  pib_mil_reais_exato: decimal,
  pib_total_bi: amount,
  pib_per_capita: amount,
  renda_media_domiciliar: amount,
  renda_media_responsavel: amount,
  gini: z.number().min(0).max(1).nullable(),
  domicilios: count,
  responsaveis_renda: count,
  responsaveis_com_renda: count,
  setores_sem_renda: count,
  setores_sob_sigilo: count,
  setores_por_massa: count,
  setores_por_media: count,
  setores_universo_renda_suprimido: count,
  total_setores: count,
  massa_rendimento_considerada: decimal,
  cobertura_renda_proporcao: z.number().min(0).max(1).nullable(),
}).strict();
export type IndicadoresMacroECenso = z.infer<typeof indicadoresSchema>;
export const origemSchema = z.enum(['ibge_bairro_oficial', 'setores_agregados']);
export type OrigemMalha = z.infer<typeof origemSchema>;
export const metodoSchema = z.enum([
  'massa_e_media_ponderada_responsaveis_validos', 'massa_por_responsaveis_validos',
  'media_ponderada_responsaveis_validos', 'sem_renda_divulgada',
]);
export type MetodoAgregacao = z.infer<typeof metodoSchema>;
export const bairroSchema = indicadoresSchema.extend({
  cd_bairro: cdBairroSchema.nullable(), id_agregacao: z.string().min(1), nm_bairro: z.string(),
  origem_malha: origemSchema, metodo_agregacao: metodoSchema,
  cd_setores: z.array(cdSetorSchema).min(1),
  total_setores: z.number().int().positive(),
  domicilios: z.number().int().nonnegative(),
  responsaveis_renda: z.number().int().nonnegative(),
  responsaveis_com_renda: z.number().int().nonnegative(),
  setores_sem_renda: z.number().int().nonnegative(),
  setores_sob_sigilo: z.number().int().nonnegative(),
  setores_por_massa: z.number().int().nonnegative(),
  setores_por_media: z.number().int().nonnegative(),
  setores_universo_renda_suprimido: z.number().int().nonnegative(),
  massa_rendimento_considerada: z.string().regex(/^[0-9]+(?:\.[0-9]+)?$/),
  pib_mil_reais: z.null(), pib_mil_reais_exato: z.null(), pib_total_bi: z.null(),
  pib_per_capita: z.null(), gini: z.null(), gini_estimado: amount,
}).strict().superRefine((b, ctx) => {
  if ((b.origem_malha === 'setores_agregados' && b.cd_bairro !== null) ||
      (b.origem_malha === 'ibge_bairro_oficial' && (b.cd_bairro === null || b.id_agregacao !== `bairro:${b.cd_bairro}`))) {
    ctx.addIssue({ code: 'custom', message: 'Origem e identificador de bairro incompatíveis' });
  }
  if (b.total_setores !== b.cd_setores.length || new Set(b.cd_setores).size !== b.cd_setores.length) {
    ctx.addIssue({ code: 'custom', message: 'Lista de setores inconsistente' });
  }
});
export type BairroDetalhe = z.infer<typeof bairroSchema>;
const metadata = z.object({
  schema_version: z.literal('2.0'), updated_at: z.string(), tipo_dados: z.string(),
  aviso: z.string(), universo_renda: z.string(),
  indicadores: z.record(z.object({
    unidade: z.string(), periodo_referencia: z.string().nullable(), fonte: z.string(),
  }).passthrough()),
}).passthrough();
const ufIdentity = z.object({ cd_uf: cdUfSchema, sigla_uf: z.string(), nm_uf: z.string(),
  cd_regiao: cdRegiaoSchema, nm_regiao: z.string() }).passthrough();
const ufIndex = z.object({ metadata: ufIdentity, resumo_uf: indicadoresSchema.nullable(),
  dados_disponiveis: z.boolean(), arquivo: z.string().nullable() });
export const brasilSchema = z.object({
  metadata: metadata.extend({ nivel: z.literal('brasil') }), resumo_brasil: indicadoresSchema,
  regioes: z.array(z.object({ cd_regiao: cdRegiaoSchema, nm_regiao: z.string(), indicadores: indicadoresSchema.nullable() })).length(5),
  ufs: z.array(ufIndex).length(27),
});
export type BrasilPayload = z.infer<typeof brasilSchema>;
export type UfIndex = z.infer<typeof ufIndex>;
export const ufSchema = z.object({
  metadata: metadata.merge(ufIdentity).extend({ nivel: z.literal('uf') }), resumo_uf: indicadoresSchema,
  municipios_resumo: z.array(z.object({ cd_mun: cdMunSchema, nm_mun: z.string(),
    indicadores: indicadoresSchema, total_bairros: count, total_setores: count, arquivo: z.string() })),
});
export type UfPayload = z.infer<typeof ufSchema>;
export const municipioSchema = z.object({
  metadata: metadata.extend({ nivel: z.literal('municipio'), cd_uf: cdUfSchema, cd_mun: cdMunSchema }),
  municipio: z.object({ cd_mun: cdMunSchema, nm_mun: z.string(), indicadores: indicadoresSchema, bairros: z.array(bairroSchema) }),
}).superRefine((p, ctx) => {
  const m = p.municipio;
  if (m.cd_mun !== p.metadata.cd_mun || !m.cd_mun.startsWith(p.metadata.cd_uf)) {
    ctx.addIssue({ code: 'custom', message: 'Município incompatível com seus metadados' });
  }
  const ids = new Set<string>(); const sectors = new Set<string>();
  for (const b of m.bairros) {
    if (ids.has(b.id_agregacao) || (b.cd_bairro !== null && !b.cd_bairro.startsWith(m.cd_mun))) {
      ctx.addIssue({ code: 'custom', message: 'Bairro duplicado ou fora do município' });
    }
    ids.add(b.id_agregacao);
    for (const code of b.cd_setores) {
      if (!code.startsWith(m.cd_mun) || sectors.has(code)) ctx.addIssue({ code: 'custom', message: 'Setor duplicado ou fora do município' });
      sectors.add(code);
    }
  }
});
export type MunicipioPayload = z.infer<typeof municipioSchema>;
export const payloadSchema = z.union([brasilSchema, ufSchema, municipioSchema]);
