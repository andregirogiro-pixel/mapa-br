import importlib
import json
from pathlib import Path
import tempfile
import unittest

build = importlib.import_module('etl_pipeline.01_build_uf_base')
geo = importlib.import_module('etl_pipeline.build_demo_geometries')


class DemoGeometriesTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.data, self.output = self.root / 'data', self.root / 'geo'
        build.build(self.data, '2026-10-25')

    def test_exact_sector_inventory_and_containment_determinism(self):
        paths = geo.build_demo_geo(self.data, self.output)
        self.assertEqual(len(paths), 7)
        before = {p.relative_to(self.output): p.read_bytes() for p in paths}
        self.assertEqual(len(json.loads((self.output / 'ufs.geojson').read_text())['features']), 27)
        for uf in ('35', '42'):
            municipalities = json.loads((self.output / f'municipios/{uf}.geojson').read_text())['features']
            for municipality in municipalities:
                code = municipality['properties']['cd_mun']
                groups = json.loads((self.data / f'municipios/{uf}/{code}.json').read_text())['municipio']['bairros']
                sectors = json.loads((self.output / f'setores/{uf}/{code}.geojson').read_text())['features']
                expected = {s: b['id_agregacao'] for b in groups for s in b['cd_setores']}
                self.assertEqual({f['properties']['cd_setor']: f['properties']['id_agregacao'] for f in sectors}, expected)
                self.assertEqual(len(sectors), len(expected))
                ring = municipality['geometry']['coordinates'][0]
                xs, ys = [p[0] for p in ring], [p[1] for p in ring]
                for f in sectors:
                    self.assertIsInstance(f['id'], str)
                    r = f['geometry']['coordinates'][0]
                    self.assertEqual(r[0], r[-1])
                    self.assertTrue(all(min(xs) <= x <= max(xs) and min(ys) <= y <= max(ys) for x, y in r))
        geo.build_demo_geo(self.data, self.output)
        self.assertEqual(before, {p.relative_to(self.output): p.read_bytes() for p in paths})

    def test_rejects_real_data_and_numeric_ids_before_publishing(self):
        path = self.data / 'brasil.json'
        original = json.loads(path.read_text())
        for change in ('real', 'numeric'):
            payload = json.loads(json.dumps(original))
            if change == 'real':
                payload['metadata']['tipo_dados'] = 'fonte_ibge_declarada'
            else:
                payload['ufs'][0]['metadata']['cd_uf'] = 11
            path.write_text(json.dumps(payload))
            with self.assertRaises((ValueError, TypeError)):
                geo.build_demo_geo(self.data, self.output)
            self.assertFalse(self.output.exists())
