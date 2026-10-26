import { useEffect, useRef, useState } from 'react';
import maplibregl, { type Map as GLMap, type GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Navigation } from '../state/navigation';
import type { DataLoader, LoadedData } from '../services/dataLoader';
import { pontosTse } from '../services/tseLoader';
import type { MunicipioTse } from '../types/tseContract';
import { loadDemoGeometry } from '../services/demoGeometry';
import type { MapGeometry } from '../types/geometry';
import { calcularBoundingBox, COLOR_SIGILO_OU_AUSENTE, COLOR_DESTAQUE_SELECIONADO, formatarValorIndicador, METRICAS_CATALOGO } from '../lib/geoStats';
import type { MetricaAtiva } from '../store/useGeoStore';

export interface MapRow { id: string; name: string; nav: Navigation; fill: string; sigilo: boolean; coverage: number | null; value: string }
interface Props { official?: boolean; officialGeometry?: MapGeometry; tse?: MunicipioTse | null; loader: DataLoader; data?: LoadedData; nav: Navigation; rows: MapRow[]; metric: MetricaAtiva; select: (nav: Navigation) => void }
const kinds = ['ufs', 'municipios', 'setores'] as const;
const fields = { ufs: 'cd_uf', municipios: 'cd_mun', setores: 'cd_setor' };
function kindFor(geo: MapGeometry) { return geo.field === 'cd_setor' ? 'setores' : geo.field === 'cd_mun' ? 'municipios' : 'ufs'; }
export function MapViewport({ loader, data, nav, rows, metric, select, tse, official = false, officialGeometry }: Props) {
  const container = useRef<HTMLDivElement>(null), map = useRef<GLMap | null>(null);
  const latest = useRef({ rows, select, nav, metric, official }); latest.current = { rows, select, nav, metric, official };
  const active = useRef<MapGeometry | undefined>(undefined);
  const [geometry, setGeometry] = useState<MapGeometry>();
  const [mapReady, setMapReady] = useState(false), [sourceReady, setSourceReady] = useState(false);
  const [error, setError] = useState(''), [hover, setHover] = useState('');
  const key = nav.level === 'municipio' || nav.level === 'bairro' || nav.level === 'setor' ? `municipio:${nav.cd_mun}` : JSON.stringify(nav);
  useEffect(() => {
    const controller = new AbortController(); setGeometry(undefined); setSourceReady(false); setError(''); setHover('');
    if (official) setGeometry(officialGeometry);
    else if (data) void loadDemoGeometry(loader, data, nav, controller.signal).then(value => {
      if (!controller.signal.aborted) setGeometry(value);
    }, e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Falha na geometria.'); });
    return () => controller.abort();
  }, [loader, data?.index, data?.uf, data?.municipio, key, official, officialGeometry]);

  function update(instance: GLMap, geo: MapGeometry) {
    const source = `${kindFor(geo)}-source`;
    if (!instance.getSource(source)) return;
    const byId = new Map(latest.current.rows.map(row => [row.id, row]));
    const selected = latest.current.nav.level === 'bairro' ? latest.current.nav.id_agregacao : latest.current.nav.level === 'setor' ? latest.current.nav.cd_setor : null;
    for (const f of geo.collection.features) {
      const code = f.properties![geo.field] as string, group = geo.rowByFeature.get(code)!;
      const row = byId.get(group);
      instance.setFeatureState({ source, id: code }, { fill: row?.fill ?? COLOR_SIGILO_OU_AUSENTE,
        sigilo: row?.sigilo ?? false, coverage: row?.coverage ?? null, selected: selected === group,
        dimmed: selected !== null && selected !== group });
    }
  }
  useEffect(() => {
    if (!container.current) return;
    let instance: GLMap;
    try {
      instance = new maplibregl.Map({ container: container.current, attributionControl: false,
        style: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#0b151e' } }] },
        center: [-52, -15], zoom: 2, renderWorldCopies: false, maxZoom: official ? 18 : 15 });
    } catch { setError('WebGL indisponível. Use a navegação por botões abaixo.'); return; }
    map.current = instance;
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    instance.on('error', () => setError('Falha ao renderizar o mapa. A navegação por botões continua disponível.'));
    instance.on('load', () => {
      for (const kind of kinds) {
        const source = `${kind}-source`;
        instance.addSource(source, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: fields[kind] });
        instance.addLayer({ id: `${kind}-fill`, type: 'fill', source, layout: { visibility: 'none' }, paint: {
          'fill-color': ['coalesce', ['feature-state', 'fill'], COLOR_SIGILO_OU_AUSENTE],
          'fill-opacity': ['case', ['boolean', ['feature-state', 'dimmed'], false], .22,
            ['boolean', ['feature-state', 'selected'], false], .95, .78],
        } });
        instance.addLayer({ id: `${kind}-line`, type: 'line', source, layout: { visibility: 'none' }, paint: {
          'line-color': ['case', ['boolean', ['feature-state', 'selected'], false], COLOR_DESTAQUE_SELECIONADO,
            ['boolean', ['feature-state', 'sigilo'], false], '#f5b75d', '#b5d8e9'],
          'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], official ? 3 : 4,
            official ? kind === 'setores' ? .6 : .9 : 2],
        } });
        instance.on('click', `${kind}-fill`, event => {
          if (instance.queryRenderedFeatures(event.point, { layers: ['tse-locais'] }).length) return;
          const geo = active.current;
          if (!geo || kindFor(geo) !== kind) return;
          const id = event.features?.[0]?.properties?.[geo.field];
          if (typeof id !== 'string') return;
          const row = latest.current.rows.find(r => r.id === geo.rowByFeature.get(id));
          if (!row) return;
          const nav = latest.current.nav;
          latest.current.select((nav.level === 'bairro' && row.id === nav.id_agregacao || nav.level === 'setor' && row.id === nav.cd_setor) ?
            { level: 'municipio', cd_uf: nav.cd_uf, cd_mun: nav.cd_mun } : row.nav);
        });
        instance.on('mousemove', `${kind}-fill`, event => {
          if (instance.queryRenderedFeatures(event.point, { layers: ['tse-locais'] }).length) return;
          const geo = active.current;
          if (!geo || kindFor(geo) !== kind) return;
          const id = event.features?.[0]?.properties?.[geo.field];
          const row = typeof id === 'string' ? latest.current.rows.find(r => r.id === geo.rowByFeature.get(id)) : undefined;
          instance.getCanvas().style.cursor = row ? 'pointer' : '';
          const coverage = row?.coverage === null ? 'desconhecida' : formatarValorIndicador(row?.coverage, 'cobertura_renda_proporcao');
          setHover(row ? latest.current.official ? `${row.name} · ${geo.field}: ${id} · Indicadores indisponíveis` : `${row.name} · ${geo.field}: ${id} · ${METRICAS_CATALOGO[latest.current.metric].label}: ${row.value} · ${row.sigilo ? 'contém setores sob sigilo' : 'sem sigilo informado'} · cobertura ${coverage}` : '');
        });
        instance.on('mouseleave', `${kind}-fill`, () => { instance.getCanvas().style.cursor = ''; setHover(''); });
      }
      instance.addSource('tse-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'id_local' });
      instance.addLayer({ id: 'tse-locais', type: 'circle', source: 'tse-source', paint: {
        'circle-radius': 7, 'circle-color': ['case', ['boolean', ['get', 'alocado'], false], '#38bdf8', '#94a3b8'],
        'circle-stroke-color': ['case', ['boolean', ['get', 'selected'], false], COLOR_DESTAQUE_SELECIONADO, '#ffffff'],
        'circle-stroke-width': ['case', ['boolean', ['get', 'selected'], false], 4, 2],
      } });
      instance.on('mousemove', 'tse-locais', event => {
        const props = event.features?.[0]?.properties;
        if (!props) return;
        instance.getCanvas().style.cursor = 'pointer';
        setHover(`${props.nm_local} · ${props.id_local} · aptos: ${props.eleitores_aptos} · votos válidos: ${props.votos_validos} · ${props.alocado ? 'alocação declarada em setor' : 'sem alocação em setor'}`);
      });
      instance.on('mouseleave', 'tse-locais', () => { instance.getCanvas().style.cursor = ''; setHover(''); });
      setMapReady(true);
    });
    const observer = new ResizeObserver(() => instance.resize()); observer.observe(container.current);
    return () => { observer.disconnect(); map.current = null; active.current = undefined; instance.remove(); };
  }, []);
  useEffect(() => {
    const instance = map.current;
    if (!instance || !mapReady) return;
    active.current = geometry;
    for (const kind of kinds) {
      const visible = geometry && kindFor(geometry) === kind ? 'visible' : 'none';
      instance.setLayoutProperty(`${kind}-fill`, 'visibility', visible);
      instance.setLayoutProperty(`${kind}-line`, 'visibility', visible);
    }
    if (!geometry) return;
    const source = `${kindFor(geometry)}-source`;
    instance.removeFeatureState({ source });
    (instance.getSource(source) as GeoJSONSource).setData(geometry.collection);
    update(instance, geometry);
    instance.once('idle', () => { if (active.current === geometry) setSourceReady(true); });
  }, [geometry, mapReady]);
  useEffect(() => { if (map.current && geometry && mapReady) update(map.current, geometry); setHover(''); }, [rows, nav, geometry, mapReady]);
  const selected = nav.level === 'bairro' ? nav.id_agregacao : nav.level === 'setor' ? nav.cd_setor : null;
  useEffect(() => {
    const source = mapReady ? map.current?.getSource('tse-source') as GeoJSONSource | undefined : undefined;
    source?.setData(pontosTse(tse, selected));
  }, [tse, selected, mapReady]);
  useEffect(() => {
    const instance = map.current;
    if (!instance || !geometry || !mapReady) return;
    const features = selected ? geometry.collection.features.filter(f => geometry.rowByFeature.get(f.properties![geometry.field] as string) === selected) : geometry.collection.features;
    const bounds = calcularBoundingBox(features);
    if (bounds) instance.fitBounds(bounds, { padding: 35, duration: 0 });
  }, [geometry, selected, mapReady]);
  return <div className="demo-map-wrap">
    <p className="demo-map-label">{official ? 'LIMITES OFICIAIS IBGE · CENSO 2022 · rosa: seleção' : 'GEOMETRIAS SINTÉTICAS · SEM LIMITES OFICIAIS · contorno âmbar: grupo com sigilo · rosa: seleção'}</p>
    {tse && <p className="demo-map-label">● Pontos TSE: ciano = alocação declarada; cinza = não alocado. Votos do local, não da população residente.</p>}
    <div ref={container} className="demo-map" data-testid={official ? 'official-map' : 'demo-map'} data-ready={mapReady && sourceReady && !!geometry && !error} data-feature-count={geometry?.collection.features.length ?? 0} data-layer={geometry?.field} aria-label={official ? 'Mapa de limites oficiais do IBGE' : 'Mapa de polígonos sintéticos'} />
    {error ? <p role="alert">{error}</p> : !sourceReady ? <p role="status">Carregando malha local…</p> : null}
    <p className="demo-map-hover" aria-live="polite">{hover || (official ? 'Clique nos polígonos ou use a lista de territórios.' : 'Clique nos polígonos ou use os botões de navegação abaixo.')}</p>
  </div>;
}
export default MapViewport;
