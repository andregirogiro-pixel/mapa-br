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
        self.assertEqual(national["pib_mil_reais"], sum(s["pib_mil_reais"] for s in summaries))
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
             "domicilios": 160, "responsaveis_renda": 100,
             "renda_media_responsavel": 2000.0},
            {"cd_setor": "420540700000002", "populacao": 600,
             "domicilios": 450, "responsaveis_renda": 300,
             "renda_media_responsavel": 4000.0},
        ]

    def aggregate(self, sectors):
        return pipeline.aggregate_sectors(sectors, cd_mun="4205407",
                                          id_agregacao="demo:grupo", nm_bairro="Demo")

    def test_household_weighted_income_and_totals(self):
        result = self.aggregate(self.sectors())
        self.assertEqual(result["renda_media_responsavel"], 3500.0)
        self.assertEqual(result["populacao"], 900)
        self.assertEqual(result["domicilios"], 610)
        self.assertEqual(result["responsaveis_renda"], 400)
        self.assertEqual(result["responsaveis_com_renda"], 400)
        self.assertEqual(result["cobertura_renda_proporcao"], 1.0)
        self.assertIsNone(result["gini_estimado"])
        self.assertIsNone(result["cd_bairro"])
        self.assertEqual(result["origem_malha"], "setores_agregados")
        self.assertEqual(len(result["cd_setores"]), 2)

    def test_zero_weights_and_missing_income(self):
        sectors = self.sectors()
        for sector in sectors:
            sector["responsaveis_renda"] = 0
            sector["renda_media_responsavel"] = None
        result = self.aggregate(sectors)
        self.assertIsNone(result["renda_media_responsavel"])
        self.assertIsNone(result["cobertura_renda_proporcao"])
        sectors[0]["responsaveis_renda"] = 1
        result = self.aggregate(sectors)
        self.assertIsNone(result["renda_media_responsavel"])
        self.assertEqual(result["cobertura_renda_proporcao"], 0.0)
        self.assertEqual(result["setores_sob_sigilo"], 0)
        self.assertEqual(result["setores_sem_renda"], 1)

    def test_invalid_weights_income_and_population(self):
        for field, invalid in (("domicilios", -1), ("domicilios", True),
                               ("domicilios", 1.5), ("populacao", -1),
                               ("responsaveis_renda", -1), ("responsaveis_renda", 1.5),
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

    def test_sigilo_excluded_from_both_numerator_and_income_denominator(self):
        sectors = self.sectors()
        sectors.append({"cd_setor": "420540700000003P", "populacao": 12,
                        "domicilios": 8, "responsaveis_renda": 4,
                        "renda_media_responsavel": None, "status_renda": "sigilo"})
        result = self.aggregate(sectors)
        self.assertEqual(result["renda_media_responsavel"], 3500.0)
        self.assertEqual(result["responsaveis_renda"], 404)
        self.assertEqual(result["responsaveis_com_renda"], 400)
        self.assertEqual(result["cobertura_renda_proporcao"], 0.9901)
        self.assertEqual(result["domicilios"], 618)
        self.assertEqual(result["populacao"], 912)
        self.assertEqual(result["setores_sob_sigilo"], 1)

    def test_total_sigilo_is_not_zero_income(self):
        sectors = self.sectors()
        for sector in sectors:
            sector.update(renda_media_responsavel=None, status_renda="sigilo")
        result = self.aggregate(sectors)
        self.assertIsNone(result["renda_media_responsavel"])
        self.assertEqual(result["cobertura_renda_proporcao"], 0.0)
        self.assertEqual(result["setores_sob_sigilo"], 2)
        self.assertEqual(result["metodo_agregacao"], "sem_renda_divulgada")

    def test_zero_income_is_valid_and_increases_coverage(self):
        sectors = self.sectors()
        sectors[0]["renda_media_responsavel"] = 0
        result = self.aggregate(sectors)
        self.assertEqual(result["renda_media_responsavel"], 3000.0)
        self.assertEqual(result["cobertura_renda_proporcao"], 1.0)

    def test_mass_takes_priority_over_rounded_mean(self):
        sectors = self.sectors()[:1]
        sectors[0].update(responsaveis_renda=3, renda_media_responsavel=33.33,
                          massa_rendimento_setor=100.03)
        sectors.append({"cd_setor": "420540700000002", "populacao": 1,
                        "domicilios": 1, "responsaveis_renda": 1,
                        "massa_rendimento_setor": 0.02})
        # Massa: 100.05 / 4 = 25.0125 -> 25.01.
        # Pela média: (33.33 * 3 + 0.02) / 4 = 25.0025 -> 25.00.
        result = self.aggregate(sectors)
        self.assertEqual(result["renda_media_responsavel"], 25.01)
        self.assertEqual(result["metodo_agregacao"], "massa_por_responsaveis_validos")
        self.assertEqual(result["setores_por_massa"], 2)

    def test_mixed_mass_and_mean_and_exact_decimal_sum(self):
        sectors = self.sectors()
        sectors[0].update(massa_rendimento_setor=200000.01)
        result = self.aggregate(sectors)
        self.assertEqual(result["metodo_agregacao"], "massa_e_media_ponderada_responsaveis_validos")
        self.assertEqual(result["setores_por_massa"], 1)
        self.assertEqual(result["setores_por_media"], 1)

    def test_decimal_half_even_and_order_independence(self):
        sectors = self.sectors()
        for sector, mass in zip(sectors, (0.01, 0.02)):
            sector.update(responsaveis_renda=1, massa_rendimento_setor=mass)
        self.assertEqual(self.aggregate(sectors)["renda_media_responsavel"], 0.02)
        self.assertEqual(self.aggregate(list(reversed(sectors))), self.aggregate(sectors))

    def test_positive_income_without_population_of_responsibles_rejected(self):
        for field in ("renda_media_responsavel", "massa_rendimento_setor"):
            sectors = self.sectors()[:1]
            sectors[0].update(responsaveis_renda=0, renda_media_responsavel=None)
            sectors[0][field] = 1
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.aggregate(sectors)

    def test_missing_universe_is_not_inferred_from_households(self):
        sectors = self.sectors()
        del sectors[0]["responsaveis_renda"]
        with self.assertRaises(KeyError):
            self.aggregate(sectors)

    def test_status_must_match_income_availability(self):
        for status in ("sigilo", "ausente", "unknown"):
            sectors = self.sectors()
            sectors[0]["status_renda"] = status
            with self.subTest(status=status), self.assertRaises(ValueError):
                self.aggregate(sectors)
        sectors[0].update(status_renda="divulgada", renda_media_responsavel=None)
        with self.assertRaises(ValueError):
            self.aggregate(sectors)

    def test_official_bairro_and_all_sector_prefixes_validated(self):
        result = pipeline.aggregate_sectors(self.sectors(), cd_mun="4205407",
            id_agregacao="grupo", nm_bairro="Centro", cd_bairro="4205407001")
        self.assertEqual(result["origem_malha"], "ibge_bairro_oficial")
        for invalid in ("3550308001", 4205407001):
            with self.subTest(code=invalid), self.assertRaises(ValueError):
                pipeline.aggregate_sectors(self.sectors(), cd_mun="4205407",
                    id_agregacao="grupo", nm_bairro="Centro", cd_bairro=invalid)
        result["cd_setores"][0] = "355030800000001"
        with self.assertRaises(ValueError):
            pipeline.validate_payload({"metadata": {"cd_uf": "42"}, "municipios": [
                {"cd_mun": "4205407", "bairros": [result]}]})


class CodeAndGdpTests(unittest.TestCase):
    def test_normalize_preserves_zeroes_and_operational_suffix(self):
        self.assertEqual(pipeline.normalize_code(" 001234567890123p ", "cd_setor"),
                         "001234567890123P")
        self.assertEqual(pipeline.validate_code("420540705000001A", "cd_setor"),
                         "420540705000001A")
        for invalid in ("420540705000001AB", "420540705000001a", "42054070500000",
                        "420540705000001!", 420540705000001):
            with self.subTest(code=invalid), self.assertRaises(ValueError):
                pipeline.validate_code(invalid, "cd_setor")
        with self.assertRaises(ValueError):
            pipeline.normalize_code(42, "cd_uf")

    def test_suffixes_remain_distinct_ids(self):
        sectors = AggregationTests().sectors()
        sectors[0]["cd_setor"] = "420540700000001A"
        sectors[1]["cd_setor"] = "420540700000001B"
        result = pipeline.aggregate_sectors(sectors, cd_mun="4205407",
            id_agregacao="grupo", nm_bairro="Demo")
        self.assertEqual(len(result["cd_setores"]), 2)

    def test_gdp_uses_canonical_unit_not_derived_billions(self):
        summaries = [{"populacao": 2, "pib_mil_reais": 1, "pib_total_bi": 999},
                     {"populacao": 1, "pib_mil_reais": 2, "pib_total_bi": 999}]
        result = pipeline.aggregate_summaries(summaries)
        self.assertEqual(result["pib_mil_reais"], 3)
        self.assertEqual(result["pib_total_bi"], 0.000003)
        self.assertEqual(result["pib_per_capita"], 1000)
        self.assertIsNone(pipeline.aggregate_summaries([])["pib_per_capita"])
        summaries[0]["pib_mil_reais"] = 1.5
        with self.assertRaises(ValueError):
            pipeline.aggregate_summaries(summaries)


if __name__ == "__main__":
    unittest.main()
