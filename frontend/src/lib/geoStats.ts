import type { Feature, Geometry } from 'geojson';
import type { IndicadoresCanonica } from '../types/contract';
import type { MetricaAtiva } from '../store/useGeoStore';
import type { Navigation } from '../state/navigation';
export interface MetricaMeta {
  id: MetricaAtiva; label: string; unidade: 'moeda' | 'moeda_bi' | 'inteiro' | 'proporcao';
  disponivelEmBairro: boolean; descricao: string;
}
export const METRICAS_CATALOGO: Record<MetricaAtiva, MetricaMeta> = {
  renda_media_responsavel: { id: 'renda_media_responsavel', label: 'Renda do responsável', unidade: 'moeda', disponivelEmBairro: true, descricao: 'Média ponderada pelo universo válido de responsáveis; exclui renda ausente ou sob sigilo.' },
  pib_per_capita: { id: 'pib_per_capita', label: 'PIB por habitante', unidade: 'moeda', disponivelEmBairro: false, descricao: 'PIB do recorte dividido pela população censitária; conferir os períodos das fontes.' },
  pib_total_bi: { id: 'pib_total_bi', label: 'PIB total (bilhões)', unidade: 'moeda_bi', disponivelEmBairro: false, descricao: 'PIB a preços correntes em bilhões de reais; disponível até município.' },
  populacao: { id: 'populacao', label: 'População', unidade: 'inteiro', disponivelEmBairro: true, descricao: 'Moradores contabilizados no recorte.' },
  cobertura_renda_proporcao: { id: 'cobertura_renda_proporcao', label: 'Cobertura da renda', unidade: 'proporcao', disponivelEmBairro: true, descricao: 'Responsáveis com renda divulgada / universo conhecido; denominador suprimido implica cobertura desconhecida.' },
  setores_sob_sigilo: { id: 'setores_sob_sigilo', label: 'Setores sob sigilo', unidade: 'inteiro', disponivelEmBairro: true, descricao: 'Quantidade de setores com renda sob sigilo estatístico.' },
};
export const CHOROPLETH_COLORS = ['#1e3a5f', '#2563eb', '#06b6d4', '#10b981', '#eab308', '#f97316'];
export const COLOR_SIGILO_OU_AUSENTE = '#334155';
export const COLOR_DESTAQUE_SELECIONADO = '#f43f5e';
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 2 });
export function formatarValorIndicador(value: number | null | undefined, metric: MetricaAtiva = 'populacao'): string {
  if (value == null || !Number.isFinite(value)) return '—'; // ausência não comprova sigilo
  switch (METRICAS_CATALOGO[metric].unidade) {
    case 'moeda': return money.format(value);
    case 'moeda_bi': return `${money.format(value)} bi`;
    case 'proporcao': return value < 1 && percent.format(value) === percent.format(1) ? '< 100%' : percent.format(value);
    default: return integer.format(value);
  }
}
export function extrairValorMetrica(ind: IndicadoresCanonica | null | undefined, metric: MetricaAtiva): number | null {
  if (!ind) return null;
  if (metric === 'cobertura_renda_proporcao') {
    if ((ind.setores_universo_renda_suprimido ?? 0) > 0) return null;
    if (ind.responsaveis_renda && ind.responsaveis_com_renda != null) return ind.responsaveis_com_renda / ind.responsaveis_renda;
  }
  const value = ind[metric];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
export function metricaDoMapa(nav: Navigation, metric: MetricaAtiva): MetricaAtiva {
  return (nav.level === 'municipio' || nav.level === 'bairro') && !METRICAS_CATALOGO[metric].disponivelEmBairro ? 'renda_media_responsavel' : metric;
}
/** Quantis interpolados (R-7); empates têm a mesma cor, incluindo distribuições constantes. */
export function criarEscalaCoropletica(values: Array<number | null | undefined>) {
  const sorted = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  const min = sorted[0] ?? null, max = sorted.at(-1) ?? null;
  const breaks = sorted.length ? CHOROPLETH_COLORS.slice(1).map((_, i) => {
    const pos = (sorted.length - 1) * (i + 1) / CHOROPLETH_COLORS.length;
    const lower = Math.floor(pos); return sorted[lower]! + (sorted[Math.ceil(pos)]! - sorted[lower]!) * (pos - lower);
  }) : [];
  const obterCor = (value: number | null | undefined): string => {
    if (min === null || value == null || !Number.isFinite(value)) return COLOR_SIGILO_OU_AUSENTE;
    if (max === min) return CHOROPLETH_COLORS[3]!;
    return CHOROPLETH_COLORS[breaks.filter(b => value > b).length]!;
  };
  return { obterCor, min, max, quebras: breaks };
}
export function calcularBoundingBox(features: Feature<Geometry | null>[]): [[number, number], [number, number]] | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  function coordinates(value: unknown): void {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      const [x, y] = value as [number, number];
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    } else value.forEach(coordinates);
  }
  function geometry(g: Geometry | null): void {
    if (!g) return;
    if (g.type === 'GeometryCollection') g.geometries.forEach(geometry); else coordinates(g.coordinates);
  }
  features.forEach(f => geometry(f.geometry));
  return Number.isFinite(x0) ? [[x0, y0], [x1, y1]] : null;
}
export interface TerritoryRow {
  id: string; name: string; code: string; values: IndicadoresCanonica | null; nav: Navigation; badge?: string;
}
