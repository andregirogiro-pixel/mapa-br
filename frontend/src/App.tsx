import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { DataLoader } from './services/dataLoader';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchMunicipioTse } from './services/tseLoader';
import type { TseState } from './components/TsePanel';
import { AnalyticalSidebar } from './components/AnalyticalSidebar';
import { METRICAS_CATALOGO, CHOROPLETH_COLORS as palette, criarEscalaCoropletica, metricaDoMapa, formatarValorIndicador as format, extrairValorMetrica as measure } from './lib/geoStats';
import type { TerritoryRow as Row } from './lib/geoStats';
import type { LoadedData } from './services/dataLoader';
import { buildSectorToGroupMap } from './services/sectorJoin';
import { navigationSearch } from './state/navigation';
import type { Navigation } from './state/navigation';
import { GeoStoreProvider, useGeoStore } from './store/useGeoStore';
import type { MetricaAtiva } from './store/useGeoStore';
import './styles.css';
import { OfficialExplorer } from './components/OfficialExplorer';

const MapViewport = lazy(() => import('./components/MapViewport'));

const defaultUrl = new URL(import.meta.env.VITE_DATA_URL || 'data/processed/brasil.json',
  new URL(import.meta.env.BASE_URL, document.baseURI)).href;
const defaultLoader = new DataLoader(defaultUrl);
const officialLoader = new DataLoader(new URL('geo/official/catalogo.json', new URL(import.meta.env.BASE_URL, document.baseURI)).href);
type Metric = MetricaAtiva;
const metricLabels = Object.fromEntries(Object.entries(METRICAS_CATALOGO).map(([id, meta]) => [id, meta.label])) as Record<Metric, string>;
const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
type Resource = { key: string; status: 'loading' | 'error' | 'ready'; data?: LoadedData; error?: string };
function useData(loader: DataLoader, nav: Navigation) {
  const client = useQueryClient();
  const country = useQuery({ queryKey: ['brasil', loader.indexUrl], queryFn: ({ signal }) => loader.load({ level: 'pais' }, signal) });
  const selected = useQuery({ queryKey: ['recorte', loader.indexUrl, navigationSearch(nav)],
    queryFn: ({ signal }) => loader.load(nav, signal), enabled: nav.level !== 'pais' && !!country.data });
  const query = nav.level === 'pais' ? country : selected;
  const error = country.error ?? query.error;
  const resource: Resource = { key: navigationSearch(nav), status: error ? 'error' : query.isPending ? 'loading' : 'ready',
    data: error ? undefined : query.data,
    error: error instanceof Error && error.name !== 'ZodError' ? error.message : error ? 'Os dados recebidos são incompatíveis com esta visualização.' : undefined };
  return { index: country.data?.index, resource,
    retry: () => { loader.clear(); void client.resetQueries(); } };
}

const position: Record<string, [number, number]> = {
  RR: [2, 0], AP: [5, 0], AM: [2, 1], PA: [4, 1], AC: [0, 2], RO: [1, 2],
  TO: [4, 2], MA: [5, 2], CE: [6, 2], RN: [7, 2], PI: [5, 3], PB: [7, 3],
  PE: [6, 3], AL: [7, 4], SE: [6, 4], BA: [5, 4], MT: [2, 3], GO: [3, 4],
  DF: [4, 4], MS: [2, 4], MG: [4, 5], ES: [5, 5], SP: [3, 6], RJ: [5, 6],
  PR: [2, 6], SC: [2, 7], RS: [1, 8],
};
export default function App({ loader = defaultLoader, mode = new URLSearchParams(window.location.search).get('modo') === 'demo' ? 'demo' : 'oficial' }: { loader?: DataLoader; mode?: 'demo' | 'oficial' }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: {
    staleTime: Infinity, gcTime: Infinity, retry: 1, refetchOnWindowFocus: false, networkMode: 'always',
  } } }));
  return <QueryClientProvider client={client}><GeoStoreProvider>{mode === 'demo' ? <Explorer loader={loader} /> : <OfficialExplorer loader={officialLoader} />}</GeoStoreProvider></QueryClientProvider>;
}
function Explorer({ loader }: { loader: DataLoader }) {
  const { navigation: nav, routeError, navigate, metrica: metric, setMetrica,
    registrarRegioes, voltarNivel } = useGeoStore(state => state);
  const { resource, index, retry } = useData(loader, nav);
  const [showTse, setShowTse] = useState(false);
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
  const election = useQuery({ queryKey: ['tse', loader.indexUrl, municipality?.cd_mun],
    queryFn: ({ signal }) => fetchMunicipioTse(loader, data!.municipio!, signal), enabled: showTse && !!data?.municipio, retry: false });
  const tseState: TseState = { enabled: showTse && !!data?.municipio, status: election.isError ? 'error' : election.isPending ? 'loading' : 'ready',
    payload: showTse && data?.municipio && election.isSuccess ? election.data : undefined,
    error: 'Não foi possível validar/carregar o sidecar TSE. Confira o contrato, o recorte e a proveniência.' };
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
  const mapMetric = metricaDoMapa(nav, metric);
  const colorRows = rows.length ? rows : ufEntry ? [{ values: ufEntry.resumo_uf }] : [];
  const numeric = colorRows.flatMap(r => measure(r.values, mapMetric) === null ? [] : [measure(r.values, mapMetric)!]);
  const { obterCor: color, min, max } = criarEscalaCoropletica(numeric);
  const ranking = [...rows].filter(r => `${r.name} ${r.code}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')))
    .sort((a, b) => (measure(b.values, mapMetric) ?? -1) - (measure(a.values, mapMetric) ?? -1) || a.name.localeCompare(b.name, 'pt-BR'));
  const cartogram = nav.level === 'pais' || nav.level === 'regiao';
  const positions = rows.map(r => position[r.code]).filter((p): p is [number, number] => Boolean(p));
  const left = positions.length ? Math.min(...positions.map(p => p[0])) : 0;
  const top = positions.length ? Math.min(...positions.map(p => p[1])) : 0;
  const columns = positions.length ? Math.max(...positions.map(p => p[0])) - left + 1 : 8;
  const demo = index?.metadata.tipo_dados === 'simulados';
  return <div className="app-shell">
    <header className="topbar"><a className="brand" href={import.meta.env.BASE_URL} onClick={e => { e.preventDefault(); navigate({ level: 'pais' }); }}>
      <span className="brand-symbol">▦</span> MAPA<span className="brand-br">BR</span><small>OBSERVATÓRIO TERRITORIAL</small></a>
      <div className="header-meta"><a className="mode-link" href={import.meta.env.BASE_URL}>Abrir mapa oficial</a><span className="live-dot" /> {demo ? 'Demonstração' : 'Exploração de dados'}<span className="header-date">{index?.metadata.updated_at}</span></div>
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
          <span className="level-tag">{({ pais: '01', regiao: '02', uf: '03', municipio: '04', bairro: '05', setor: '05' })[nav.level]} / 05</span></div>
        <div className="map-controls"><label>Colorir por <select value={metric} onChange={e => setMetrica(e.target.value as Metric)}>
          {Object.entries(metricLabels).map(([key, label]) => <option key={key} value={key}>{label}{!METRICAS_CATALOGO[key as Metric].disponivelEmBairro ? ' (Até Município)' : ''}</option>)}</select></label></div>
        {municipality && <label className="tse-toggle"><input type="checkbox" checked={showTse} onChange={e => setShowTse(e.target.checked)} /> Exibir locais de votação (TSE)</label>}
        <p className="muted">{METRICAS_CATALOGO[metric].descricao}</p>
        {metric !== mapMetric && <p role="status" className="metric-fallback">O IBGE não calcula PIB para bairros/setores. O mapa e a comparação intramunicipal usam Renda do responsável. A seleção de PIB será retomada ao voltar à UF.</p>}
        {index && cartogram && <div className="region-pills" aria-label="Regiões">{index.regioes.map(r => <button key={r.cd_regiao}
          aria-pressed={nav.level === 'regiao' && nav.cd_regiao === r.cd_regiao} onClick={() => navigate({ level: 'regiao', cd_regiao: r.cd_regiao })}>{r.nm_regiao}</button>)}</div>}
        {index && demo && <Suspense fallback={<p role="status">Preparando mapa local…</p>}><MapViewport loader={loader} data={data} nav={nav} select={navigate} metric={mapMetric} tse={tseState.payload}
          rows={(rows.length ? rows : ufEntry ? [{ id: ufEntry.metadata.cd_uf, name: ufEntry.metadata.nm_uf,
            values: ufEntry.resumo_uf, nav: { level: 'uf' as const, cd_uf: ufEntry.metadata.cd_uf } }] : []).map(r => ({
              id: r.id, name: r.name, nav: r.nav, fill: color(measure(r.values, mapMetric)),
              sigilo: (r.values?.setores_sob_sigilo ?? 0) > 0,
              value: format(measure(r.values, mapMetric), mapMetric),
              coverage: measure(r.values, 'cobertura_renda_proporcao'),
            }))} /></Suspense>}
        {resource.status === 'loading' ? <div className="empty-map" role="status"><span className="loading-pulse" />Carregando o recorte selecionado…</div> :
          resource.status === 'error' ? <div className="empty-map" role="alert"><h2>Não foi possível abrir este recorte</h2><p>{resource.error}</p><button onClick={retry}>Tentar novamente</button><button onClick={() => navigate({ level: 'pais' })}>Voltar ao Brasil</button></div> :
          cartogram ? <div className="cartogram-wrap"><div className="cartogram" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {rows.map(r => { const p = position[r.code]; const shade = color(measure(r.values, mapMetric)); return p ? <button key={r.id} className="uf-tile" aria-label={`${r.name} (${r.code})`}
              onClick={() => navigate(r.nav)} style={{ gridColumn: p[0] - left + 1, gridRow: p[1] - top + 1, backgroundColor: shade, color: palette.slice(3).includes(shade) ? '#071c14' : '#effff6' }}>
              <strong>{r.code}</strong><small>{r.badge === 'Detalhe disponível' ? '↳' : '·'}</small></button> : null; })}
          </div></div> : <div className="territory-cards">{rows.length ? rows.map(r => <button key={r.id} onClick={() => navigate(r.nav)}
            className={`territory-card ${nav.level === 'bairro' && nav.id_agregacao === r.id ? 'selected' : ''}`} aria-pressed={nav.level === 'bairro' && nav.id_agregacao === r.id}>
            <span className="territory-swatch" style={{ backgroundColor: color(measure(r.values, mapMetric)) }} /><small>{r.badge ?? 'Município'}</small>
            <strong>{r.name}</strong><span>{format(measure(r.values, mapMetric), mapMetric)}</span><code>{r.code}</code></button>) :
            <div className="empty-map"><h2>{demo ? 'Detalhamento municipal não disponível nesta amostra' : 'Resumo disponível'}</h2><p>O desdobramento municipal não faz parte do recorte carregado.</p></div>}</div>}
        <div className="map-footer"><strong>{METRICAS_CATALOGO[mapMetric].label} · quantis</strong><div className="legend"><span>{format(min, mapMetric)}</span><i style={{ background: `linear-gradient(90deg, ${palette.flatMap((color, i) => [`${color} ${i * 100 / palette.length}%`, `${color} ${(i + 1) * 100 / palette.length}%`]).join(", ")})` }} /><span>{format(max, mapMetric)}</span><em>■ sem dado</em></div>
          <p>{cartogram ? 'Navegação por botões. Geometrias da demonstração são sintéticas.' :
            'Lista de territórios. Limites oficiais ainda não foram disponibilizados.'}</p>
          {reverse && <span className="map-note">{number.format(reverse.size)} setores vinculados aos grupos deste município</span>}</div>
      </section>
      <AnalyticalSidebar data={data} values={values} bairro={bairro} title={title} nav={nav} demo={demo}
        rows={rows} ranking={ranking} metric={mapMetric} search={search} setSearch={setSearch}
        navigate={navigate} resourceStatus={resource.status} max={max ?? 0} tse={tseState} />
    </main><footer className="page-footer"><span>MAPA BR / TERRITÓRIO EM PERSPECTIVA</span><span>País → Região → UF → Município → Bairro / Setor</span></footer>
  </div>;
}
