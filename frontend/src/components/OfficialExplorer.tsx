import { lazy, Suspense, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DataHttpError, DataLoader } from '../services/dataLoader';
import { loadOfficialCartography } from '../services/officialGeometry';
import { navigationSearch, type Navigation } from '../state/navigation';
import { useGeoStore } from '../store/useGeoStore';
import { COLOR_SIGILO_OU_AUSENTE } from '../lib/geoStats';
import type { MapRow } from './MapViewport';
const MapViewport = lazy(() => import('./MapViewport'));

export function OfficialExplorer({ loader }: { loader: DataLoader }) {
  const { navigation: nav, navigate, registrarRegioes, voltarNivel, routeError } = useGeoStore(s => s);
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const country = useQuery({ queryKey: ['cartografia', loader.indexUrl, ''], queryFn: ({ signal }) => loadOfficialCartography(loader, { level: 'pais' }, signal) });
  const selected = useQuery({ queryKey: ['cartografia', loader.indexUrl, navigationSearch(nav)],
    queryFn: ({ signal }) => loadOfficialCartography(loader, nav, signal), enabled: nav.level !== 'pais' && !!country.data });
  const query = nav.level === 'pais' ? country : selected;
  const data = query.data;
  const error = country.error ?? query.error;
  const ufs = country.data?.country.features ?? [];
  useEffect(() => { if (country.data) registrarRegioes(country.data.country.features.map(f => f.properties)); }, [country.data, registrarRegioes]);
  useEffect(() => setSearch(''), [navigationSearch(nav)]);
  const uf = 'cd_uf' in nav ? ufs.find(f => f.properties.cd_uf === nav.cd_uf)?.properties : undefined;
  const title = data?.title ?? (nav.level === 'pais' ? 'Brasil' : nav.level === 'uf' ? uf?.nm_uf : undefined);
  const rows: MapRow[] = !data || data.unavailableGeometry ? [] : data.geometry.collection.features.map(f => {
    const p = f.properties!;
    const target: Navigation = data.geometry.field === 'cd_setor' ? { level: 'setor', cd_uf: p.cd_uf, cd_mun: p.cd_mun, cd_setor: p.cd_setor } :
      data.geometry.field === 'cd_mun' ? { level: 'municipio', cd_uf: p.cd_uf, cd_mun: p.cd_mun } : { level: 'uf', cd_uf: p.cd_uf };
    return { id: p[data.geometry.field], name: p.cd_setor ? `Setor ${p.cd_setor}` : p.nm_mun ?? `${p.nm_uf} (${p.sigla_uf})`, nav: target,
      fill: COLOR_SIGILO_OU_AUSENTE, sigilo: false, coverage: null, value: 'Indicadores indisponíveis' };
  });
  const filtered = rows.filter(r => `${r.name} ${r.id}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const selectedSector = nav.level === 'setor' ? nav.cd_setor : undefined;
  const message = error instanceof DataHttpError && error.status === 404 ? 'Arquivo de geometria oficial indisponível localmente. Execute a preparação das malhas desta entrega.' :
    error instanceof Error && error.name !== 'ZodError' ? error.message : 'A geometria recebida é incompatível com o catálogo auditado.';
  return <div className="app-shell official-shell">
    <header className="topbar"><a className="brand" href={import.meta.env.BASE_URL} onClick={e => { e.preventDefault(); navigate({ level: 'pais' }); }}><span className="brand-symbol">▦</span> MAPA<span className="brand-br">BR</span><small>OBSERVATÓRIO TERRITORIAL</small></a>
      <a className="mode-link" href={`${import.meta.env.BASE_URL}?modo=demo`}>Abrir demonstração · dados simulados</a></header>
    <div className="provenance"><span>MAPA OFICIAL · IBGE</span>Referência territorial: Censo 2022 · Indicadores estatísticos indisponíveis</div>
    <nav className="toolbar" aria-label="Navegação territorial"><div className="breadcrumbs">
      <button disabled={nav.level === 'pais'} onClick={voltarNivel}>← Voltar nível</button><button onClick={() => navigate({ level: 'pais' })}>Brasil</button>
      {uf && <><span>/</span><button onClick={() => navigate({ level: 'uf', cd_uf: uf.cd_uf })}>{uf.nm_uf}</button></>}
      {'cd_mun' in nav && <><span>/</span><button onClick={() => navigate({ level: 'municipio', cd_uf: nav.cd_uf, cd_mun: nav.cd_mun })}>{data?.geometry.collection.features[0]?.properties?.nm_mun ?? nav.cd_mun}</button></>}
      {selectedSector && <><span>/</span><span aria-current="page">{selectedSector}</span></>}
    </div><select aria-label="Selecionar UF" value={uf?.cd_uf ?? ''} onChange={e => { if (e.target.value) navigate({ level: 'uf', cd_uf: e.target.value }); }}>
      <option value="">Ir para uma UF</option>{ufs.map(f => <option key={f.properties.cd_uf} value={f.properties.cd_uf}>{f.properties.sigla_uf} · {f.properties.nm_uf}</option>)}</select></nav>
    {routeError && <p role="alert" className="notice">{routeError}</p>}
    <main className="split-screen"><section className="map-panel" aria-label="Exploração territorial">
      <div className="map-heading"><div><span className="eyebrow">CARTOGRAFIA OFICIAL / {nav.level.toUpperCase()}</span><h1>{title ?? 'Carregando território…'}</h1></div><span className="level-tag">CENSO 2022</span></div>
      <div className="map-controls"><label>Colorir por <select aria-label="Colorir por" disabled value="neutro"><option value="neutro">Sem indicadores · preenchimento neutro</option></select></label></div>
      <p role="status" className="metric-fallback">Indicadores indisponíveis para este recorte. A identificação e a navegação territorial permanecem disponíveis.</p>
      {error ? <div className="empty-map" role="alert"><h2>Não foi possível abrir a geometria oficial</h2><p>{message}</p><button onClick={() => { loader.clear(); void client.resetQueries({ queryKey: ['cartografia', loader.indexUrl] }); }}>Tentar novamente</button><button onClick={() => navigate({ level: 'pais' })}>Voltar ao Brasil</button></div> :
        <Suspense fallback={<p role="status">Preparando mapa local…</p>}><MapViewport loader={loader} official officialGeometry={data?.geometry} nav={nav} rows={rows} metric="populacao" select={navigate} /></Suspense>}
      {query.isPending && !error && <p role="status">Carregando o recorte selecionado…</p>}
      {data?.unavailableGeometry && <p role="status" className="notice">{data.unavailableGeometry} O contorno do território selecionado permanece visível.</p>}
      <div className="map-footer"><strong>■ Território sem indicadores</strong><p>Contornos oficiais preparados localmente. Clique no mapa ou navegue pela lista de territórios.</p></div>
    </section><aside className="analytics" aria-label="Identificação territorial">
      <span className="eyebrow">TERRITÓRIO / IBGE</span><h2>{title ?? 'Carregando…'}</h2>
      <p className="muted">{data ? `${new Intl.NumberFormat('pt-BR').format(data.geometry.collection.features.length)} ${data.geometry.field === 'cd_setor' ? 'setores censitários' : data.geometry.field === 'cd_mun' ? 'municípios' : 'unidades da federação'} no mapa` : 'Aguardando a malha local.'}</p>
      {selectedSector && <div className="origin-badge">Setor censitário: <strong>{selectedSector}</strong><p>Município IBGE: {'cd_mun' in nav ? nav.cd_mun : ''}</p></div>}
      {data?.geometry.field === 'cd_setor' && <p className="muted">Exibindo setores censitários individuais. Não há agrupamento por bairro nesta entrega.</p>}
      <div className="ranking"><h3>Navegar por território</h3><label className="muted" htmlFor="territory-search">Buscar nome ou código</label><input id="territory-search" type="search" value={search} onChange={e => setSearch(e.target.value)} />
        <div className="ranking-rows official-territories" aria-label="Lista de territórios">{filtered.map(r => <button className="ranking-row" key={r.id} aria-pressed={selectedSector === r.id} onClick={() => navigate(r.nav)}><span className="rank-name"><strong>{r.name}</strong><small>{r.id}</small></span><span>→</span></button>)}</div>
        {rows.length > 0 && !filtered.length && <p role="status">Nenhum território encontrado para a busca.</p>}
      </div><div className="source-details"><strong>Fontes e disponibilidade</strong><p>Malhas oficiais IBGE, referência Censo 2022. Renda, população, PIB e TSE não foram publicados neste modo.</p><a href={`${import.meta.env.BASE_URL}geo/official/proveniencia.json`} target="_blank" rel="noreferrer">Consultar fontes, transformações e hashes locais</a></div>
    </aside></main><footer className="page-footer"><span>MAPA BR / TERRITÓRIO EM PERSPECTIVA</span><span>Brasil → Santa Catarina → Florianópolis → Setor censitário</span></footer>
  </div>;
}
