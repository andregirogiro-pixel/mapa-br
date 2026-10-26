import type { MunicipioTse } from '../types/tseContract';
import { formatarValorIndicador as format } from '../lib/geoStats';
export interface TseState { enabled: boolean; status: 'loading' | 'error' | 'ready'; payload?: MunicipioTse | null; error?: string }
export function TsePanel({ state, group }: { state: TseState; group: string | null }) {
  if (!state.enabled) return null;
  if (state.status === 'loading') return <p role="status">Carregando sidecar eleitoral…</p>;
  if (state.status === 'error') return <p role="alert">{state.error}</p>;
  const p = state.payload;
  if (!p) return <p>Dados eleitorais não disponíveis para este município.</p>;
  const aggregation = group ? p.por_agregacao.find(a => a.id_agregacao === group) : undefined;
  const ind = group ? aggregation?.indicadores : p.resumo_municipio;
  const covered = p.locais_votacao.filter(l => l.cd_setor_alocado !== null).reduce((n, l) => n + l.indicadores.eleitores_aptos, 0);
  const coverage = p.resumo_municipio.eleitores_aptos > 0 ? covered / p.resumo_municipio.eleitores_aptos : null;
  return <section className="aggregation-audit" aria-label="Indicadores eleitorais">
    <h3>{p.metadata.tipo_dados === 'simulados' ? 'TSE · SIMULAÇÃO' : 'TSE · fonte declarada'}</h3>
    <p>{p.metadata.ano_eleicao} · turno {p.metadata.nr_turno} · {p.metadata.cargo}</p>
    <p className="notice">{p.metadata.aviso_metodologico}</p>
    <p>Votos dos locais de votação contidos no perímetro; não representam a residência dos eleitores nem distribuição uniforme na área.</p>
    <dl><dt>Locais no município</dt><dd>{format(p.resumo_municipio.total_locais)}</dd>
      <dt>Georreferenciados / não alocados</dt><dd>{format(p.resumo_municipio.locais_georreferenciados)} / {format(p.resumo_municipio.locais_nao_alocados)}</dd>
      <dt>Cobertura de alocação do eleitorado municipal</dt><dd>{format(coverage, 'cobertura_renda_proporcao')}</dd>
      {aggregation && <><dt>Locais / seções no grupo</dt><dd>{format(aggregation.total_locais)} / {format(aggregation.total_secoes)}</dd></>}
    </dl>
    {ind ? <dl><dt>Aptos / comparecimento / abstenção</dt><dd>{format(ind.eleitores_aptos)} / {format(ind.comparecimento)} / {format(ind.abstencao)}</dd>
      <dt>Nominais / legenda</dt><dd>{format(ind.votos_nominais)} / {format(ind.votos_legenda)}</dd>
      <dt>Válidos / brancos / nulos</dt><dd>{format(ind.votos_validos)} / {format(ind.votos_brancos)} / {format(ind.votos_nulos)}</dd></dl> :
      <p>Sem agregação eleitoral publicada para este grupo; ausência não equivale a zero votos.</p>}
  </section>;
}
