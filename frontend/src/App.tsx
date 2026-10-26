import { useEffect, useMemo, useState } from 'react';
import { DataLoader } from './services/dataLoader';
import type { LoadedData } from './services/dataLoader';
import { buildSectorToGroupMap } from './services/sectorJoin';
import { navigationSearch } from './state/navigation';
import type { Navigation } from './state/navigation';
import type { BrasilPayload, IndicadoresMacroECenso } from './types/contract';
import { GeoStoreProvider, useGeoStore } from './store/useGeoStore';
import type { MetricaAtiva } from './store/useGeoStore';
import './styles.css';

const defaultUrl = new URL(import.meta.env.VITE_DATA_URL || 'data/processed/brasil.json',
  new URL(import.meta.env.BASE_URL, document.baseURI)).href;
const defaultLoader = new DataLoader(defaultUrl);
type Metric = MetricaAtiva;
const metricLabels: Record<Metric, string> = {
  populacao: 'População', pib_per_capita: 'PIB por habitante',
  renda_media_responsavel: 'Renda do responsável', cobertura_renda_proporcao: 'Cobertura da renda',
  pib_total_bi: 'PIB total (bilhões)', setores_sob_sigilo: 'Setores sob sigilo',
};
const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 2 });
const format = (value: number | null | undefined, metric: Metric = 'populacao') => value == null ? '—' :
  metric === 'populacao' || metric === 'setores_sob_sigilo' ? number.format(value) : metric === 'cobertura_renda_proporcao' ?
    (value < 1 && percent.format(value) === percent.format(1) ? '< 100%' : percent.format(value)) : metric === 'pib_total_bi' ? `${money.format(value)} bi` : money.format(value);
function measure(values: IndicadoresMacroECenso | null | undefined, metric: Metric): number | null {
  if (!values) return null;
  if (metric === 'cobertura_renda_proporcao') {
    if ((values.setores_universo_renda_suprimido ?? 0) > 0) return null;
    if (values.responsaveis_renda && values.responsaveis_com_renda !== null) {
      return values.responsaveis_com_renda / values.responsaveis_renda;
    }
  }
  return values[metric];
}
interface Row { id: string; name: string; code: string; values: IndicadoresMacroECenso | null; nav: Navigation; badge?: string }

type Resource = { key: string; status: 'loading' | 'error' | 'ready'; data?: LoadedData; error?: string };
function useData(loader: DataLoader, nav: Navigation) {
  const key = navigationSearch(nav);
  const [attempt, setAttempt] = useState(0);
  const [index, setIndex] = useState<BrasilPayload>();
  const [resource, setResource] = useState<Resource>({ key, status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    setResource({ key, status: 'loading' });
    void loader.load(nav, controller.signal).then(data => {
      if (!controller.signal.aborted) { setIndex(data.index); setResource({ key, status: 'ready', data }); }
    }, error => {
      if (!controller.signal.aborted) setResource({ key, status: 'error', error:
        error instanceof Error && error.name !== 'ZodError' ? error.message : 'Os dados recebidos são incompatíveis com esta visualização.' });
    });
    return () => controller.abort();
    // A representação canônica inclui todos os campos da união discriminada.
  }, [loader, key, attempt]);
  return { index, resource: resource.key === key ? resource : { key, status: 'loading' } as Resource,
    retry: () => { loader.clear(); setAttempt(a => a + 1); } };
}

const position: Record<string, [number, number]> = {
  RR: [2, 0], AP: [5, 0], AM: [2, 1], PA: [4, 1], AC: [0, 2], RO: [1, 2],
  TO: [4, 2], MA: [5, 2], CE: [6, 2], RN: [7, 2], PI: [5, 3], PB: [7, 3],
  PE: [6, 3], AL: [7, 4], SE: [6, 4], BA: [5, 4], MT: [2, 3], GO: [3, 4],
  DF: [4, 4], MS: [2, 4], MG: [4, 5], ES: [5, 5], SP: [3, 6], RJ: [5, 6],
  PR: [2, 6], SC: [2, 7], RS: [1, 8],
};
const palette = ['#15362f', '#205747', '#317b60', '#4da47d', '#80d6a3'];
function color(value: number | null | undefined, min: number, max: number) {
  if (value == null) return '#26313b';
  return palette[Math.min(4, Math.floor((max === min ? 0.5 : (value - min) / (max - min)) * 4))] || '#15362f';
}

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

export default function App({ loader = defaultLoader }: { loader?: DataLoader }) {
  return <GeoStoreProvider><Explorer loader={loader} /></GeoStoreProvider>;
}
function Explorer({ loader }: { loader: DataLoader }) {
  const { navigation: nav, routeError, navigate, metrica: metric, setMetrica,
    registrarRegioes, voltarNivel } = useGeoStore(state => state);
  const { resource, index, retry } = useData(loader, nav);
  useEffect(() => {
    if (index) registrarRegioes(index.ufs.map(uf => uf.metadata));
  }, [index, registrarRegioes]);
  const [search, setSearch] = useState('');
  useEffect(() => setSearch(''), [navigationSearch(nav)]);
  const data = resource.status === 'ready' ? resource.data : undefined;
  const ufEntry = nav.level !== 'pais' && nav.level !== 'regiao' ? index?.ufs.find(u => u.metadata.cd_uf === nav.cd_uf) : undefined;
  const region = nav.level === 'regiao' ? index?.regioes.find(r => r.cd_regiao === nav.cd_regiao) :
    index?.regioes.find(r => r.cd_regiao === ufEntry?.metadata.cd_regiao);
  const municipality = data?.municipio?.municipio;
  const bairro = nav.level === 'bairro' ? municipality?.bairros.find(b => b.id_agregacao === nav.id_agregacao) : undefined;
  const reverse = useMemo(() => municipality ? buildSectorToGroupMap(municipality.bairros) : undefined, [municipality]);
  const title = nav.level === 'pais' ? 'Brasil' : nav.level === 'regiao' ? region?.nm_regiao :
    nav.level === 'uf' ? ufEntry?.metadata.nm_uf : nav.level === 'municipio' ? municipality?.nm_mun : bairro?.nm_bairro;
  const values = nav.level === 'pais' ? data?.index.resumo_brasil : nav.level === 'regiao' ? region?.indicadores :
    nav.level === 'uf' ? data?.uf?.resumo_uf ?? ufEntry?.resumo_uf : nav.level === 'municipio' ? municipality?.indicadores : bairro;
  let rows: Row[] = [];
  if (data && (nav.level === 'pais' || nav.level === 'regiao')) rows = data.index.ufs
    .filter(u => nav.level !== 'regiao' || u.metadata.cd_regiao === nav.cd_regiao)
    .map(u => ({ id: u.metadata.cd_uf, code: u.metadata.sigla_uf, name: u.metadata.nm_uf, values: u.resumo_uf,
      nav: { level: 'uf', cd_uf: u.metadata.cd_uf }, badge: u.dados_disponiveis && u.arquivo ? 'Detalhe disponível' : 'Resumo' }));
  else if (data?.uf && nav.level === 'uf') rows = data.uf.municipios_resumo.map(m => ({
    id: m.cd_mun, code: m.cd_mun, name: m.nm_mun, values: m.indicadores,
    nav: { level: 'municipio', cd_uf: nav.cd_uf, cd_mun: m.cd_mun } }));
  else if (municipality && (nav.level === 'municipio' || nav.level === 'bairro')) rows = municipality.bairros.map(b => ({
    id: b.id_agregacao, code: b.id_agregacao, name: b.nm_bairro, values: b,
    nav: { level: 'bairro', cd_uf: nav.cd_uf, cd_mun: nav.cd_mun, id_agregacao: b.id_agregacao },
    badge: b.origem_malha === 'ibge_bairro_oficial' ? 'Bairro oficial' : 'Setores agregados',
  }));
  const numeric = rows.flatMap(r => measure(r.values, metric) === null ? [] : [measure(r.values, metric)!]);
  const min = numeric.length ? Math.min(...numeric) : 0;
  const max = numeric.length ? Math.max(...numeric) : 0;
  const ranking = [...rows].filter(r => `${r.name} ${r.code}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')))
    .sort((a, b) => (measure(b.values, metric) ?? -1) - (measure(a.values, metric) ?? -1) || a.name.localeCompare(b.name, 'pt-BR'));
  const cartogram = nav.level === 'pais' || nav.level === 'regiao';
  const positions = rows.map(r => position[r.code]).filter((p): p is [number, number] => Boolean(p));
  const left = positions.length ? Math.min(...positions.map(p => p[0])) : 0;
  const top = positions.length ? Math.min(...positions.map(p => p[1])) : 0;
  const columns = positions.length ? Math.max(...positions.map(p => p[0])) - left + 1 : 8;
  const demo = index?.metadata.tipo_dados === 'simulados';
  return <div className="app-shell">
    <header className="topbar"><a className="brand" href={import.meta.env.BASE_URL} onClick={e => { e.preventDefault(); navigate({ level: 'pais' }); }}>
      <span className="brand-symbol">▦</span> MAPA<span className="brand-br">BR</span><small>OBSERVATÓRIO TERRITORIAL</small></a>
      <div className="header-meta"><span className="live-dot" /> {demo ? 'Demonstração' : 'Exploração de dados'}<span className="header-date">{index?.metadata.updated_at}</span></div>
    </header>
    <div className="provenance"><span>{demo ? 'DADOS SIMULADOS' : 'RECORTE DA FONTE DECLARADA'}</span>
      {demo ? 'Indicadores ilustrativos. Não representam estatísticas oficiais.' : 'A cobertura territorial e os períodos dependem dos arquivos fornecidos.'}</div>
    <nav className="toolbar" aria-label="Navegação territorial"><div className="breadcrumbs">
      <button className="back-level" disabled={nav.level === 'pais'} onClick={voltarNivel}>← Voltar nível</button>
      <button onClick={() => navigate({ level: 'pais' })}>Brasil</button>
      {nav.level !== 'pais' && region && <><span>/</span><button onClick={() => navigate({ level: 'regiao', cd_regiao: region.cd_regiao })}>{region.nm_regiao}</button></>}
      {ufEntry && <><span>/</span><button onClick={() => navigate({ level: 'uf', cd_uf: ufEntry.metadata.cd_uf })}>{ufEntry.metadata.sigla_uf}</button></>}
      {municipality && nav.level !== 'pais' && nav.level !== 'regiao' && nav.level !== 'uf' && <><span>/</span>
        <button onClick={() => navigate({ level: 'municipio', cd_uf: nav.cd_uf, cd_mun: nav.cd_mun })}>{municipality.nm_mun}</button></>}
      {bairro && <><span>/</span><span aria-current="page">{bairro.nm_bairro}</span></>}
    </div><select aria-label="Selecionar UF" value={ufEntry?.metadata.cd_uf ?? ''} onChange={e => {
      if (e.target.value) navigate({ level: 'uf', cd_uf: e.target.value });
    }}><option value="">Ir para uma UF</option>{index?.ufs.map(u => <option key={u.metadata.cd_uf} value={u.metadata.cd_uf}>{u.metadata.sigla_uf} · {u.metadata.nm_uf}</option>)}</select></nav>
    {routeError && <div role="alert" className="notice">{routeError}</div>}
    <main className="split-screen">
      <section className="map-panel" aria-label="Exploração territorial">
        <div className="map-heading"><div><span className="eyebrow">EXPLORAÇÃO TERRITORIAL / {nav.level.toUpperCase()}</span><h1>{title ?? 'Carregando território…'}</h1></div>
          <span className="level-tag">{({ pais: '01', regiao: '02', uf: '03', municipio: '04', bairro: '05' })[nav.level]} / 05</span></div>
        <div className="map-controls"><label>Colorir por <select value={metric} onChange={e => setMetrica(e.target.value as Metric)}>
          {Object.entries(metricLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
        {index && cartogram && <div className="region-pills" aria-label="Regiões">{index.regioes.map(r => <button key={r.cd_regiao}
          aria-pressed={nav.level === 'regiao' && nav.cd_regiao === r.cd_regiao} onClick={() => navigate({ level: 'regiao', cd_regiao: r.cd_regiao })}>{r.nm_regiao}</button>)}</div>}
        {resource.status === 'loading' ? <div className="empty-map" role="status"><span className="loading-pulse" />Carregando o recorte selecionado…</div> :
          resource.status === 'error' ? <div className="empty-map" role="alert"><h2>Não foi possível abrir este recorte</h2><p>{resource.error}</p><button onClick={retry}>Tentar novamente</button><button onClick={() => navigate({ level: 'pais' })}>Voltar ao Brasil</button></div> :
          cartogram ? <div className="cartogram-wrap"><div className="cartogram" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {rows.map(r => { const p = position[r.code]; const shade = color(measure(r.values, metric), min, max); return p ? <button key={r.id} className="uf-tile" aria-label={`${r.name} (${r.code})`}
              onClick={() => navigate(r.nav)} style={{ gridColumn: p[0] - left + 1, gridRow: p[1] - top + 1, backgroundColor: shade, color: palette.slice(3).includes(shade) ? '#071c14' : '#effff6' }}>
              <strong>{r.code}</strong><small>{r.badge === 'Detalhe disponível' ? '↳' : '·'}</small></button> : null; })}
          </div></div> : <div className="territory-cards">{rows.length ? rows.map(r => <button key={r.id} onClick={() => navigate(r.nav)}
            className={`territory-card ${nav.level === 'bairro' && nav.id_agregacao === r.id ? 'selected' : ''}`} aria-pressed={nav.level === 'bairro' && nav.id_agregacao === r.id}>
            <span className="territory-swatch" style={{ backgroundColor: color(measure(r.values, metric), min, max) }} /><small>{r.badge ?? 'Município'}</small>
            <strong>{r.name}</strong><span>{format(measure(r.values, metric), metric)}</span><code>{r.code}</code></button>) :
            <div className="empty-map"><h2>{demo ? 'Detalhamento municipal não disponível nesta amostra' : 'Resumo disponível'}</h2><p>O desdobramento municipal não faz parte do recorte carregado.</p></div>}</div>}
        <div className="map-footer"><div className="legend"><span>{format(numeric.length ? min : null, metric)}</span><i /><span>{format(numeric.length ? max : null, metric)}</span><em>■ sem dado</em></div>
          <p>{cartogram ? 'Cartograma esquemático de UFs. As posições não representam limites geográficos.' :
            'Visão tabular do território. A malha geográfica ainda não foi disponibilizada.'}</p>
          {reverse && <span className="map-note">{number.format(reverse.size)} setores vinculados aos grupos deste município</span>}</div>
      </section>
      <aside className="analytics" aria-label="Painel analítico">
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
        </> : <p className="muted">{resource.status === 'ready' ? 'Não há indicadores para este recorte.' : 'Os indicadores aparecerão após o carregamento do território.'}</p>}
      </aside>
    </main><footer className="page-footer"><span>MAPA BR / TERRITÓRIO EM PERSPECTIVA</span><span>País → Região → UF → Município → Bairro / Setor</span></footer>
  </div>;
}
