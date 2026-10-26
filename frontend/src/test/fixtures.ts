import brasil from '../../../data/processed/brasil.json';
import sc from '../../../data/processed/uf/42.json';
import sp from '../../../data/processed/uf/35.json';
import floripa from '../../../data/processed/municipios/42/4205407.json';
import joinville from '../../../data/processed/municipios/42/4209102.json';
import saoPaulo from '../../../data/processed/municipios/35/3550308.json';
import campinas from '../../../data/processed/municipios/35/3509502.json';
import { vi } from 'vitest';

export const fixtures: Record<string, unknown> = {
  'brasil.json': brasil, 'uf/42.json': sc, 'uf/35.json': sp,
  'municipios/42/4205407.json': floripa, 'municipios/42/4209102.json': joinville,
  'municipios/35/3550308.json': saoPaulo, 'municipios/35/3509502.json': campinas,
};
export const base = 'https://example.test/observatorio/data/processed/';
export function fixtureFetcher() {
  return vi.fn<typeof fetch>(async input => {
    const path = new URL(String(input)).pathname.split('/data/processed/')[1] ?? '';
    const data = fixtures[path];
    return new Response(JSON.stringify(data ?? { error: 'missing' }), { status: data ? 200 : 404 });
  });
}
