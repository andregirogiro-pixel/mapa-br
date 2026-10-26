import unittest
from etl_pipeline.prepare_official_geometries import checked_code, compare_inventory

class OfficialGeometryChecks(unittest.TestCase):
    def test_preserves_textual_identifiers(self):
        self.assertEqual(checked_code('420540705000001', 'cd_setor'), '420540705000001')
        for value in [420540705000001, ' 420540705000001', '42054070500000a']:
            with self.assertRaises(ValueError): checked_code(value, 'cd_setor')

    def test_inventory_compares_sets_not_only_count(self):
        with self.assertRaisesRegex(ValueError, 'missing.*420540705000002.*extra.*420540705000003'):
            compare_inventory(['420540705000001', '420540705000003'], ['420540705000001', '420540705000002'], 'fixture')
        self.assertEqual(compare_inventory(['42'], ['42'], 'UF')['missing'], [])

    def test_rejects_duplicate_inventory(self):
        with self.assertRaisesRegex(ValueError, 'duplicado'):
            compare_inventory(['42', '42'], ['42'], 'fixture')
