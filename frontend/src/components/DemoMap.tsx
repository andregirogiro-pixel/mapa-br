import { useEffect, useRef, useState } from 'react';
import maplibregl, { type Map as GLMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Navigation } from '../state/navigation';
import type { DataLoader, LoadedData } from '../services/dataLoader';
import { loadDemoGeometry, type DemoGeometry } from '../services/demoGeometry';

export interface MapRow { id: string; name: string; nav: Navigation; fill: string; sigilo: boolean; coverage: number | null }
function coverageLabel(value: number | null): string {
  if (value === null) return 'desconhecida';
  const formatter = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 2 });
  return value < 1 && formatter.format(value) === formatter.format(1) ? '< 100%' : formatter.format(value);
}
interface Props { loader: DataLoader; data: LoadedData; nav: Navigation; rows: MapRow[]; select: (nav: Navigation) => void }
export default function DemoMap({ loader, data, nav, rows, select }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<GLMap | null>(null);
  const latest = useRef({ rows, select, nav }); latest.current = { rows, select, nav };
  const [geometry, setGeometry] = useState<DemoGeometry>();
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState('');
  const key = nav.level === 'municipio' || nav.level === 'bairro' ? `municipio:${nav.cd_mun}` : JSON.stringify(nav);
  useEffect(() => {
    const controller = new AbortController(); setGeometry(undefined); setError(''); setReady(false); setHover('');
    void loadDemoGeometry(loader, data, nav, controller.signal).then(value => {
      if (!controller.signal.aborted) setGeometry(value);
    }, e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Falha na geometria.'); });
    return () => controller.abort();
  }, [loader, data.index, data.uf, data.municipio, key]);

  function update(instance: GLMap, geo: DemoGeometry) {
    if (!instance.getSource('demo')) return;
    const byId = new Map(latest.current.rows.map(row => [row.id, row]));
    for (const feature of geo.collection.features) {
      const code = feature.properties![geo.field] as string;
      const group = geo.rowByFeature.get(code)!;
      const row = byId.get(group);
      instance.setFeatureState({ source: 'demo', id: code }, { fill: row?.fill ?? '#26313b',
        sigilo: row?.sigilo ?? false, coverage: row?.coverage ?? null,
        selected: latest.current.nav.level === 'bairro' && latest.current.nav.id_agregacao === group });
    }
  }
  useEffect(() => {
    if (!geometry || !container.current) return;
    let instance: GLMap;
    try {
      instance = new maplibregl.Map({ container: container.current, attributionControl: false,
        style: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#0b151e' } }] },
        center: [-52, -15], zoom: 2, renderWorldCopies: false, maxZoom: 15 });
    } catch { setError('WebGL indisponível. Use a navegação por botões abaixo.'); return; }
    map.current = instance;
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    instance.on('error', () => setError('Falha ao renderizar o mapa. A navegação por botões continua disponível.'));
    instance.on('load', () => {
      instance.addSource('demo', { type: 'geojson', data: geometry.collection, promoteId: geometry.field });
      instance.addLayer({ id: 'territories', type: 'fill', source: 'demo', paint: {
        'fill-color': ['coalesce', ['feature-state', 'fill'], '#26313b'],
        'fill-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 1, .72],
      } });
      instance.addLayer({ id: 'outlines', type: 'line', source: 'demo', paint: {
        'line-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#ffffff',
          ['boolean', ['feature-state', 'sigilo'], false], '#f5b75d', '#80d6a3'],
        'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 4, 2],
      } });
      update(instance, geometry);
      const bounds = new maplibregl.LngLatBounds();
      for (const f of geometry.collection.features) for (const ring of f.geometry.coordinates) for (const p of ring) bounds.extend([p[0]!, p[1]!]);
      instance.fitBounds(bounds, { padding: 35, duration: 0 });
      setReady(true);
    });
    instance.on('click', 'territories', event => {
      const id = event.features?.[0]?.properties?.[geometry.field];
      if (typeof id !== 'string') return;
      const row = latest.current.rows.find(r => r.id === geometry.rowByFeature.get(id));
      if (row) latest.current.select(row.nav);
    });
    instance.on('mousemove', 'territories', event => {
      const id = event.features?.[0]?.properties?.[geometry.field];
      const row = typeof id === 'string' ? latest.current.rows.find(r => r.id === geometry.rowByFeature.get(id)) : undefined;
      instance.getCanvas().style.cursor = row ? 'pointer' : '';
      setHover(row ? `${row.name} · ${row.sigilo ? 'contém setores sob sigilo' : 'sem sigilo informado'} · cobertura ${coverageLabel(row.coverage)}` : '');
    });
    instance.on('mouseleave', 'territories', () => { instance.getCanvas().style.cursor = ''; setHover(''); });
    const observer = new ResizeObserver(() => instance.resize()); observer.observe(container.current);
    return () => { observer.disconnect(); map.current = null; instance.remove(); };
  }, [geometry]);
  useEffect(() => { if (map.current && geometry) update(map.current, geometry); }, [rows, nav, geometry]);
  return <div className="demo-map-wrap">
    <p className="demo-map-label">GEOMETRIAS SINTÉTICAS · SEM LIMITES OFICIAIS · contorno âmbar: grupo com sigilo</p>
    <div ref={container} className="demo-map" data-testid="demo-map" data-ready={ready} aria-label="Mapa de polígonos sintéticos" />
    {error ? <p role="alert">{error}</p> : !ready ? <p role="status">Carregando malha local…</p> : null}
    <p className="demo-map-hover" aria-live="polite">{hover || 'Clique nos polígonos ou use os botões de navegação abaixo.'}</p>
  </div>;
}
