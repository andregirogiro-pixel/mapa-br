"""Integração offline do adaptador: fontes sintéticas, nunca bases oficiais."""
import csv
from dataclasses import replace
from decimal import Decimal
import importlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from etl_pipeline import core_contract

adapter = importlib.import_module("etl_pipeline.02_ingest_ibge_real")
demo = importlib.import_module("etl_pipeline.01_build_uf_base")


class IngestTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        fields = ("cd_setor", "cd_mun", "nm_mun", "cd_dist", "nm_dist", "cd_subdist",
                  "nm_subdist", "cd_bairro", "nm_bairro", "situacao_setor", "populacao",
                  "domicilios", "responsaveis_renda", "renda_media_responsavel", "massa_rendimento_setor")
        self.manifest = adapter.IBGEReleaseManifest(
            release_censo="release_sintetica_para_testes", periodo_censo="2022", periodo_pib="2021",
            universo_renda="Responsáveis DPPO inclusive sem rendimento (teste)",
            csv_encoding="utf-8", csv_delimiter=";", decimal_separator=",",
            col_map_setor={field: f"origem_{i}" for i, field in enumerate(fields)},
            col_map_pib_mun={"cd_mun": "territorio_pib", "pib_mil_reais": "valor_pib"})
        self.sectors_path = self.root / "setores.csv"
        self.gdp_path = self.root / "pib.csv"
        self.output = self.root / "output"

    def row(self, n=1, mun="4205407", **overrides):
        values = dict(cd_setor=mun + "0100" + f"{n:04d}", cd_mun=mun,
                      nm_mun="Município de teste", cd_dist=mun + "01", nm_dist="Sede",
                      cd_subdist=mun + "0100", nm_subdist="", cd_bairro="", nm_bairro="",
                      situacao_setor="1", populacao="30", domicilios="20", responsaveis_renda="10",
                      renda_media_responsavel="100,50", massa_rendimento_setor="1005,00")
        values.update(overrides)
        return {self.manifest.col_map_setor[k]: v for k, v in values.items()}

    def save(self, rows, gdp=None):
        with self.sectors_path.open("w", encoding="utf-8", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=list(self.manifest.col_map_setor.values()), delimiter=";")
            writer.writeheader()
            writer.writerows(rows)
        with self.gdp_path.open("w", encoding="utf-8", newline="") as stream:
            writer = csv.writer(stream, delimiter=";")
            writer.writerow(self.manifest.col_map_pib_mun.values())
            writer.writerows(gdp if gdp is not None else [("4205407", "12345,678")])

    def run_ingest(self):
        return adapter.ingest(self.sectors_path, self.gdp_path, self.manifest,
                              self.output, "2026-10-25")

    def read(self, path):
        return json.loads((self.output / path).read_text(encoding="utf-8"))

    def hybrid_rows(self):
        return [self.row(1, cd_bairro="4205407001", nm_bairro="Centro"),
                self.row(2, cd_bairro="4205407001", nm_bairro="Centro"),
                self.row(3, cd_bairro="0", situacao_setor="Urbana"),
                self.row(4, cd_bairro="4205407000", situacao_setor="8")]

    def test_shared_engine_identity(self):
        for name in ("normalize_code", "validate_code", "nonnegative", "aggregate_sectors",
                     "aggregate_summaries", "validate_payload"):
            self.assertIs(getattr(adapter, name), getattr(core_contract, name))
            self.assertIs(getattr(demo, name), getattr(core_contract, name))

    def test_sigilo_and_comma_decimal_csv(self):
        self.save([self.row(renda_media_responsavel="2.500,50", massa_rendimento_setor="25005,00")])
        with self.assertRaisesRegex(ValueError, "milhar"):
            self.run_ingest()
        self.assertFalse(self.output.exists())
        self.save([self.row(1, renda_media_responsavel="2500,50", massa_rendimento_setor="25005,00"),
                   self.row(2, renda_media_responsavel="X", massa_rendimento_setor="X", responsaveis_renda="4")])
        self.run_ingest()
        municipality = self.read("municipios/42/4205407.json")["municipio"]
        indicators = municipality["indicadores"]
        self.assertEqual(indicators["renda_media_responsavel"], 2500.50)
        self.assertEqual(indicators["domicilios"], 40)
        self.assertEqual(indicators["responsaveis_renda"], 14)
        self.assertEqual(indicators["responsaveis_com_renda"], 10)
        self.assertEqual(indicators["setores_sob_sigilo"], 1)
        self.assertEqual(indicators["cobertura_renda_proporcao"], round(10 / 14, 4))

    def test_hybrid_official_urban_rural_groups_and_order(self):
        rows = self.hybrid_rows()
        self.save(list(reversed(rows)))
        self.run_ingest()
        bairros = self.read("municipios/42/4205407.json")["municipio"]["bairros"]
        self.assertEqual(len(bairros), 3)
        self.assertEqual(bairros[0]["id_agregacao"], "bairro:4205407001")
        self.assertEqual(bairros[0]["total_setores"], 2)
        self.assertEqual([b["id_agregacao"] for b in bairros[1:]],
                         ["subdist:42054070100:rural", "subdist:42054070100:urbano"])
        self.assertIn("Distrito Sede", bairros[1]["nm_bairro"])
        before = (self.output / "municipios/42/4205407.json").read_bytes()
        self.save(rows)
        self.run_ingest()
        self.assertEqual(before, (self.output / "municipios/42/4205407.json").read_bytes())

    def test_lost_zeroes_rejected(self):
        for field, bad in (("cd_mun", "205407"), ("cd_setor", "20540701000001")):
            self.save([self.row(**{field: bad})])
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "inválido"):
                self.run_ingest()

    def test_bottom_up_reconciliation_exact_mass_and_fractional_gdp(self):
        self.save(self.hybrid_rows() + [self.row(1, mun="3550308")],
                  [("4205407", "12345,678"), ("3550308", "100,001")])
        self.run_ingest()
        national = self.read("brasil.json")["resumo_brasil"]
        for uf, code in (("42", "4205407"), ("35", "3550308")):
            municipality = self.read(f"municipios/{uf}/{code}.json")["municipio"]
            indicators = municipality["indicadores"]
            for field in ("populacao", "domicilios", "responsaveis_renda"):
                self.assertEqual(sum(b[field] for b in municipality["bairros"]), indicators[field])
            self.assertEqual(sum(Decimal(b["massa_rendimento_considerada"]) for b in municipality["bairros"]),
                             Decimal(indicators["massa_rendimento_considerada"]))
            self.assertEqual(self.read(f"uf/{uf}.json")["resumo_uf"]["domicilios"], indicators["domicilios"])
        self.assertEqual(national["populacao"], 150)
        self.assertEqual(national["pib_mil_reais_exato"], "12445.679")
        self.assertEqual(national["renda_media_responsavel"], 100.5)

    def test_water_bodies_filtered_from_census_and_gdp(self):
        self.save([self.row(), self.row(mun="4300001"), self.row(mun="4300002")],
                  [("4205407", "10"), ("4300001", "X"), ("4300002", "X")])
        self.run_ingest()
        self.assertFalse((self.output / "uf/43.json").exists())
        self.assertEqual(self.read("brasil.json")["resumo_brasil"]["populacao"], 30)

    def test_all_outputs_pass_contract_with_release_metadata(self):
        self.save(self.hybrid_rows())
        paths = self.run_ingest()
        self.assertEqual(len(paths), 3)
        for path in paths:
            payload = json.loads(path.read_text())
            adapter.validate_payload(payload)
            metadata = payload["metadata"]
            self.assertEqual(metadata["schema_version"], "2.0")
            self.assertEqual(metadata["release_censo"], self.manifest.release_censo)
            self.assertEqual(metadata["mapeamento_variaveis_censo"], self.manifest.col_map_setor)
            self.assertEqual(metadata["indicadores"]["populacao"]["periodo_referencia"], "2022")
            self.assertEqual(metadata["indicadores"]["pib_mil_reais"]["periodo_referencia"], "2021")
        self.assertNotIn('"cd_setores"', (self.output / "uf/42.json").read_text())
        self.assertIsNone(next(u for u in self.read("brasil.json")["ufs"] if u["metadata"]["cd_uf"] == "11")["resumo_uf"])

    def test_missing_extra_and_duplicate_gdp_fail_integrity(self):
        for gdp in ([], [("3550308", "1")], [("4205407", "1"), ("3550308", "2")],
                    [("4205407", "1"), ("4205407", "2")]):
            self.save([self.row()], gdp)
            with self.subTest(gdp=gdp), self.assertRaises(ValueError):
                self.run_ingest()
        self.assertFalse(self.output.exists())

    def test_duplicate_sectors_fail_after_normalization(self):
        rows = [self.row(cd_setor="420540701000001a"), self.row(cd_setor=" 420540701000001A ")]
        self.save(rows)
        with self.assertRaisesRegex(ValueError, "UNIQUE"):
            self.run_ingest()

    def test_administrative_prefix_mismatch_and_unknown_situation(self):
        for field, bad in (("cd_dist", "420540702"), ("cd_subdist", "42054070101"),
                           ("situacao_setor", "99"), ("cd_bairro", "3550308001")):
            self.save([self.row(**{field: bad})])
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.run_ingest()

    def test_suppressed_denominator_requires_all_income_measures_suppressed(self):
        self.save([self.row(responsaveis_renda="X", renda_media_responsavel="X", massa_rendimento_setor="X")])
        self.run_ingest()
        summary = self.read("brasil.json")["resumo_brasil"]
        self.assertEqual(summary["setores_universo_renda_suprimido"], 1)
        self.assertEqual(summary["setores_sob_sigilo"], 1)
        self.assertIsNone(summary["cobertura_renda_proporcao"])
        for field, bad in (("massa_rendimento_setor", "0"), ("massa_rendimento_setor", ".."),
                           ("renda_media_responsavel", "1")):
            values = dict(responsaveis_renda="X", renda_media_responsavel="X", massa_rendimento_setor="X")
            values[field] = bad
            self.save([self.row(**values)])
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.run_ingest()

    def test_demographic_absence_and_physical_invariants(self):
        for field, bad in (("populacao", "X"), ("populacao", ".."), ("domicilios", ""),
                           ("responsaveis_renda", ".."), ("responsaveis_renda", "999")):
            self.save([self.row(**{field: bad})])
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.run_ingest()

    def test_numeric_parser_markers_precision_and_invalid_formats(self):
        for marker in adapter.AUSENTE_MARKERS:
            self.assertEqual(adapter.parse_ibge_numeric(marker, field="x"), (None, "ausente"))
        for bad in (True, "NaN", "Infinity", "-1", "1_000", "1.000,00", "1,2,3"):
            with self.subTest(value=bad), self.assertRaises(ValueError):
                adapter.parse_ibge_numeric(bad, field="x")
        self.assertEqual(adapter.parse_ibge_numeric("0,123456789012345678", field="x")[0],
                         Decimal("0.123456789012345678"))
        self.assertEqual(adapter.parse_ibge_numeric("0", field="x")[1], "divulgada")
        with self.assertRaises(ValueError):
            adapter.parse_ibge_numeric("1,5", field="x", as_integer=True)

    def test_optional_mass_or_mean_and_missing_territorial_columns(self):
        mapping = dict(self.manifest.col_map_setor)
        for field in ("cd_dist", "cd_subdist", "nm_subdist", "massa_rendimento_setor"):
            mapping[field] = None
        manifest = replace(self.manifest, col_map_setor=mapping)
        sector = adapter.adapt_sector(self.row(), manifest)
        self.assertEqual(sector["cd_subdist"], "42054070100")
        self.assertEqual(adapter.group_municipality_sectors([sector], cd_mun="4205407")[0]["renda_media_responsavel"], 100.5)

    def test_cli_with_manifest_json(self):
        self.save(self.hybrid_rows())
        manifest_path = self.root / "manifest.json"
        from dataclasses import asdict
        manifest_path.write_text(json.dumps(asdict(self.manifest)))
        result = subprocess.run([sys.executable, str(Path(adapter.__file__)), "--manifest", str(manifest_path),
            "--setores", str(self.sectors_path), "--pib", str(self.gdp_path),
            "--output-dir", str(self.output), "--date", "2026-10-25"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("brasil.json", result.stdout)

    def test_parquet_schema_rejected_before_reading_even_empty_file(self):
        import pyarrow as pa
        import pyarrow.parquet as pq
        path = self.root / "numeric_codes.parquet"
        values = self.row()
        arrays = {key: pa.array([], type=pa.int64() if key == self.manifest.col_map_setor["cd_mun"] else pa.string())
                  for key in values}
        pq.write_table(pa.table(arrays), path)
        with self.assertRaises(TypeError):
            list(adapter.iter_source_rows(path, self.manifest.col_map_setor, self.manifest))

    def test_parquet_string_codes_and_native_numeric_metrics(self):
        import pyarrow as pa
        import pyarrow.parquet as pq
        row = self.row()
        for field in ("populacao", "domicilios", "responsaveis_renda"):
            row[self.manifest.col_map_setor[field]] = int(row[self.manifest.col_map_setor[field]])
        row[self.manifest.col_map_setor["renda_media_responsavel"]] = Decimal("100.50")
        row[self.manifest.col_map_setor["massa_rendimento_setor"]] = Decimal("1005.00")
        self.save([])
        self.sectors_path = self.root / "setores.parquet"
        pq.write_table(pa.Table.from_pylist([row]), self.sectors_path)
        self.run_ingest()
        self.assertEqual(self.read("brasil.json")["resumo_brasil"]["renda_media_responsavel"], 100.5)


if __name__ == "__main__":
    unittest.main()
