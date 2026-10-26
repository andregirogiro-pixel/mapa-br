import type { LoadedData } from '../services/dataLoader';
import type { Navigation } from '../state/navigation';
import type { IndicadoresMacroECenso, BairroDetalhe } from '../types/contract';
import type { MetricaAtiva as Metric } from '../store/useGeoStore';
import { METRICAS_CATALOGO, formatarValorIndicador as format, extrairValorMetrica as measure } from '../lib/geoStats';
import type { TerritoryRow as Row } from '../lib/geoStats';
const metricLabels = Object.fromEntries(Object.entries(METRICAS_CATALOGO).map(([id, meta]) => [id, meta.label])) as Record<Metric, string>;
const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 2 });
function Scatter({ rows, select }: { rows: Row[]; select: (nav: Navigation) => void }) {
  const points = rows.filter(r => r.values?.renda_media_responsavel != null);
  const maxPop = Math.max(1, ...points.map(r => r.values!.populacao));
  const maxIncome = Math.max(1, ...points.map(r => r.values!.renda_media_responsavel!));
  return <section className="chart"><div className="section-heading"><h3>População × renda</h3><span>mesmo universo de renda</span></div>
    {points.length < 2 ? <p className="muted">São necessários dois territórios com renda divulgada para comparar.</p> :
      <svg viewBox="0 0 420 170" role="group" aria-label="Dispersão: população e renda do responsável">
        {[30, 70, 110].map(y => <line key={y} x1="35" x2="400" y1={y} y2={y} className="chart-grid" />)}
        <text x="35" y="15">RENDA DO RESPONSÁVEL</text><text x="310" y="164">POPULAÇÃO →</text>
        {points.map(r => <g key={r.id} role="button" tabIndex={0} aria-label={`Explorar ${r.name}`} onClick={() => select(r.nav)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(r.nav); } }}>
          <circle cx={40 + r.values!.populacao / maxPop * 345} cy={138 - r.values!.renda_media_responsavel! / maxIncome * 105} r="6">
            <title>{r.name}: {format(r.values!.renda_media_responsavel, 'renda_media_responsavel')}</title>
          </circle>
        </g>)}
      </svg>}
  </section>;
}

function Quality({ values }: { values: IndicadoresMacroECenso }) {
  const unknown = (values.setores_universo_renda_suprimido ?? 0) > 0;
  const suppressed = (values.setores_sob_sigilo ?? 0) > 0;
  const coverage = measure(values, 'cobertura_renda_proporcao');
  return <section className={`quality ${unknown || suppressed ? 'quality-warning' : ''}`}>
    <div><span className="eyebrow">COBERTURA DA RENDA</span><strong>{format(coverage, 'cobertura_renda_proporcao')}</strong></div>
    <p>{unknown ? 'Parte do denominador está sob sigilo. A cobertura total é desconhecida.' : suppressed ?
      `${number.format(values.setores_sob_sigilo!)} ${values.setores_sob_sigilo === 1 ? 'setor' : 'setores'} sob sigilo. A média considera somente a parcela com renda divulgada.` :
      values.cobertura_renda_proporcao === null ? 'Sem base suficiente para calcular a cobertura de renda.' :
      'A cobertura se refere ao universo dos responsáveis, não ao total físico de domicílios.'}</p>
    <div className="coverage-track"><i style={{ width: `${(coverage ?? 0) * 100}%` }} /></div>
  </section>;
}

interface Props {
  data?: LoadedData; values: IndicadoresMacroECenso | null | undefined; bairro?: BairroDetalhe;
  title?: string; nav: Navigation; demo: boolean; rows: Row[]; ranking: Row[]; metric: Metric;
  search: string; setSearch: (search: string) => void; navigate: (nav: Navigation) => void;
  resourceStatus: 'loading' | 'error' | 'ready'; max: number;
}
export function AnalyticalSidebar({ data, values, bairro, title, nav, demo, rows, ranking, metric,
  search, setSearch, navigate, resourceStatus, max }: Props) {
  return <aside className="analytics" aria-label="Painel analítico">
        <div className="section-heading"><div><span className="eyebrow">LEITURA DO TERRITÓRIO</span><h2>{title ?? 'Indicadores'}</h2></div><span className="data-tag">{demo ? 'SIMULAÇÃO' : 'RECORTE'}</span></div>
        {data && values ? <>
          {bairro && <div className="origin-badge">{bairro.origem_malha === 'ibge_bairro_oficial' ? 'Bairro Oficial IBGE' : 'Agrupamento de Setores por Subdistrito/Distrito'}</div>}
          <div className="indicator-grid">
            <article><span>População</span><strong>{format(values.populacao)}</strong><small>pessoas no recorte</small></article>
            <article><span>Renda do responsável</span><strong>{format(values.renda_media_responsavel, 'renda_media_responsavel')}</strong><small>BRL / responsável / mês</small></article>
            <article><span>PIB por habitante</span><strong>{format(values.pib_per_capita, 'pib_per_capita')}</strong><small>{values.pib_per_capita == null ? 'não disponível neste nível' : 'BRL / pessoa / ano'}</small></article>
            <article><span>Índice de Gini</span><strong>{values.gini == null ? '—' : values.gini.toLocaleString('pt-BR')}</strong><small>{values.gini == null ? 'distribuição não disponível' : 'escala de 0 a 1'}</small></article>
          </div>
          <Quality values={values} />
          <section className="aggregation-audit" aria-label="Auditoria de agregação">
            <h3>Auditoria de agregação ponderada</h3>
            <dl>
              <dt>{(values.setores_universo_renda_suprimido ?? 0) > 0 ? 'Responsáveis conhecidos (universo parcial)' : 'Responsáveis no universo'}</dt><dd>{format(values.responsaveis_renda)}</dd>
              <dt>Peso com renda divulgada</dt><dd>{format(values.responsaveis_com_renda)}</dd>
              <dt>Setores por média / por massa</dt><dd>{format(values.setores_por_media)} / {format(values.setores_por_massa)}</dd>
              <dt>Massa considerada (BRL/mês, decimal exato)</dt><dd><code>{values.massa_rendimento_considerada ?? 'indisponível'}</code></dd>
              <dt>PIB total</dt><dd>{format(values.pib_total_bi, 'pib_total_bi')}</dd>
              <dt>PIB exato (mil BRL)</dt><dd><code>{values.pib_mil_reais_exato ?? 'indisponível'}</code></dd>
            </dl>
          </section>

          {nav.level === 'municipio' && data.uf && values.pib_mil_reais != null && data.uf.resumo_uf.pib_mil_reais ?
            <p className="share">{percent.format(values.pib_mil_reais / data.uf.resumo_uf.pib_mil_reais)} do PIB do recorte estadual</p> : null}
          {bairro ? <section className="sector-list"><div className="section-heading"><h3>Setores que compõem o grupo</h3><span>{bairro.total_setores} setores</span></div>
            <ul>{bairro.cd_setores.map(code => <li key={code}><code>{code}</code><span>vinculado</span></li>)}</ul>
            <p className="muted">A seleção usa o identificador do grupo, inclusive quando não há código de bairro oficial.</p></section> : <>
            <section className="ranking"><div className="section-heading"><h3>{nav.level === 'pais' || nav.level === 'regiao' ? 'Comparar UFs' : nav.level === 'uf' ? 'Comparar municípios' : 'Bairros e agrupamentos'}</h3><span>{rows.length} territórios</span></div>
              {rows.length > 0 && <input aria-label="Buscar território" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar nome ou código…" />}
              <div className="ranking-label"><span>TERRITÓRIO</span><span>{metricLabels[metric].toUpperCase()}</span></div>
              <div className="ranking-rows">{ranking.map((r, i) => <button key={r.id} className="ranking-row" onClick={() => navigate(r.nav)}>
                <span className="rank-number">{String(i + 1).padStart(2, '0')}</span><span className="rank-name"><strong>{r.name}</strong><small>{r.badge ?? r.code}</small></span>
                <span className="rank-value">{format(measure(r.values, metric), metric)}<i style={{ width: `${max && measure(r.values, metric) != null ? measure(r.values, metric)! / max * 100 : 0}%` }} /></span><span>↗</span>
              </button>)}{!ranking.length && <p className="muted">{rows.length ? 'Nenhum território corresponde à busca.' : 'Sem desdobramento neste recorte.'}</p>}</div>
            </section><Scatter rows={rows} select={navigate} />
          </>}
          <details className="source-details"><summary>Fonte, períodos e rastreabilidade</summary>
            <p>{data.index.metadata.aviso}</p><p>Universo: {data.index.metadata.universo_renda}</p>
            <p>Renda: {data.index.metadata.indicadores.renda_media_responsavel?.periodo_referencia ?? 'sem período estatístico real'} · PIB: {data.index.metadata.indicadores.pib_mil_reais?.periodo_referencia ?? 'sem período estatístico real'}</p>
            <p>Domicílios físicos: {format(values.domicilios)} · responsáveis com renda: {format(values.responsaveis_com_renda)} / {format(values.responsaveis_renda)}</p>
            <p>Massa de renda considerada: <code>{values.massa_rendimento_considerada ?? 'indisponível'}</code> BRL/mês</p>
            <p>PIB exato: <code>{values.pib_mil_reais_exato ?? 'indisponível'}</code> mil BRL</p>
            {bairro && <code>{bairro.id_agregacao}</code>}
          </details>
        </> : <p className="muted">{resourceStatus === 'ready' ? 'Não há indicadores para este recorte.' : 'Os indicadores aparecerão após o carregamento do território.'}</p>}
      </aside>;
}
