import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';
/** Geometria navegável, independente da disponibilidade de indicadores. */
export interface MapGeometry {
  collection: FeatureCollection<Polygon | MultiPolygon>;
  field: string;
  rowByFeature: Map<string, string>;
}
