"""Testes offline de contrato, particionamento e agregação territorial."""

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "01_build_uf_base.py"
spec = importlib.util.spec_from_file_location("build_uf_base", SCRIPT)
pipeline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pipeline)


class BuildTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        pipeline.build(self.root, "2026-10-25")
        self.index = self.read("brasil.json")

    def read(self, relative):
        return json.loads((self.root / relative).read_text(encoding="utf-8"))

    def test_27_ufs_and_five_regions_without_municipal_payloads(self):
        self.assertEqual(len(self.index["ufs"]), 27)
        self.assertEqual(len({u["metadata"]["cd_uf"] for u in self.index["ufs"]}), 27)
        self.assertEqual(len(self.index["regioes"]), 5)
        serialized = json.dumps(self.index)
        for forbidden in ('"municipios"', '"bairros"', '"cd_mun"', '"cd_setor"'):
            self.assertNotIn(forbidden, serialized)

    def test_partitions_and_lazy_paths(self):
        self.assertEqual({p.name for p in (self.root / "uf").iterdir()},
                         {"35.json", "42.json"})
        for uf in self.index["ufs"]:
            if uf["dados_disponiveis"]:
                payload = self.read(uf["arquivo"])
                self.assertEqual(payload["metadata"]["cd_uf"], uf["metadata"]["cd_uf"])
                self.assertEqual(len(payload["municipios"]), 2)
                self.assertEqual(payload["resumo_uf"], uf["resumo_uf"])
                pipeline.validate_payload(payload)
            else:
                self.assertIsNone(uf["arquivo"])

    def test_repeatability(self):
        before = {p: p.read_bytes() for p in self.root.rglob("*.json")}
        pipeline.build(self.root, "2026-10-25")
        self.assertEqual(before, {p: p.read_bytes() for p in before})

    def test_explicit_provenance(self):
        for path in self.root.rglob("*.json"):
            metadata = json.loads(path.read_text())["metadata"]
            self.assertEqual(metadata["tipo_dados"], "simulados")
            self.assertEqual(metadata["updated_at"], "2026-10-25")
            self.assertIn("DEMONSTRAÇÃO", metadata["aviso"])
            self.assertIsNone(metadata["indicadores"]["populacao"]["periodo_referencia"])

    def test_national_and_regional_totals(self):
        summaries = [u["resumo_uf"] for u in self.index["ufs"]]
        national = self.index["resumo_brasil"]
        self.assertEqual(national["populacao"], sum(s["populacao"] for s in summaries))
        self.assertAlmostEqual(national["pib_total_bi"], sum(s["pib_total_bi"] for s in summaries))
        self.assertIsNone(national["gini"])
        self.assertIsNone(national["renda_media_domiciliar"])
        self.assertEqual(sum(r["indicadores"]["populacao"] for r in self.index["regioes"]),
                         national["populacao"])

    def test_malformed_ids_and_cross_uf_join_rejected(self):
        for invalid in (42, "4", "042", "4a", "４２"):
            with self.subTest(value=invalid), self.assertRaises(ValueError):
                pipeline.validate_code(invalid, "cd_uf")
        self.assertEqual(pipeline.validate_code("001234567890123", "cd_setor"),
                         "001234567890123")
        payload = self.read("uf/42.json")
        payload["municipios"][0]["cd_mun"] = "3550308"
        with self.assertRaises(ValueError):
            pipeline.validate_payload(payload)


class AggregationTests(unittest.TestCase):
    def sectors(self):
        return [
            {"cd_setor": "420540700000001", "populacao": 300,
             "domicilios": 100, "renda_media_responsavel": 2000.0},
            {"cd_setor": "420540700000002", "populacao": 600,
             "domicilios": 300, "renda_media_responsavel": 4000.0},
        ]

    def aggregate(self, sectors):
        return pipeline.aggregate_sectors(sectors, cd_mun="4205407",
                                          id_agregacao="demo:grupo", nm_bairro="Demo")

    def test_household_weighted_income_and_totals(self):
        result = self.aggregate(self.sectors())
        self.assertEqual(result["renda_media_responsavel"], 3500.0)
        self.assertEqual(result["populacao"], 900)
        self.assertEqual(result["domicilios"], 400)
        self.assertIsNone(result["gini_estimado"])
        self.assertIsNone(result["cd_bairro"])
        self.assertEqual(result["origem_malha"], "setores_agregados")
        self.assertEqual(len(result["cd_setores"]), 2)

    def test_zero_weights_and_missing_income(self):
        sectors = self.sectors()
        for sector in sectors:
            sector["domicilios"] = 0
            sector["renda_media_responsavel"] = None
        self.assertIsNone(self.aggregate(sectors)["renda_media_responsavel"])
        sectors[0]["domicilios"] = 1
        with self.assertRaises(ValueError):
            self.aggregate(sectors)

    def test_invalid_weights_income_and_population(self):
        for field, invalid in (("domicilios", -1), ("domicilios", True),
                               ("domicilios", 1.5), ("populacao", -1),
                               ("renda_media_responsavel", float("nan")),
                               ("renda_media_responsavel", float("inf"))):
            sectors = self.sectors()
            sectors[0][field] = invalid
            with self.subTest(field=field, value=invalid), self.assertRaises(ValueError):
                self.aggregate(sectors)

    def test_duplicate_or_foreign_sectors_rejected(self):
        for invalid in ("420540700000001", "355030800000001", 420540700000002):
            sectors = self.sectors()
            sectors[1]["cd_setor"] = invalid
            with self.subTest(value=invalid), self.assertRaises(ValueError):
                self.aggregate(sectors)
        with self.assertRaises(ValueError):
            self.aggregate([])


if __name__ == "__main__":
    unittest.main()
