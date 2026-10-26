"""Fontes oficiais simuladas em ZIP/CSV/SIDRA: nenhum download nos testes."""
from copy import deepcopy
import csv
import hashlib
import importlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

fetch = importlib.import_module("etl_pipeline.03_fetch_ibge_raw")


class FetchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.profile = {
            "release_censo": "2022_TESTE_SINTETICO", "periodo_censo": "2022",
            "universo_renda": "Responsáveis DPPO inclusive sem rendimento (teste)",
            "domicilios_universo": "total_fisico",
            "dictionary_url": "https://ftp.ibge.gov.br/test/2022/dicionario.pdf",
            "tables": [
                {"name": "basico", "periodo": "2022", "scope": "national", "urls": ["https://ftp.ibge.gov.br/test/2022/basico.zip"],
                 "encoding": "utf-8-sig", "delimiter": ";", "decimal_separator": ",", "member_pattern": "basico*.csv",
                 "columns": {"cd_setor": "CODE", "populacao": "POP", "domicilios": "DOM", "situacao_setor": "SITU",
                             "cd_bairro": "BAIRRO", "nm_bairro": "NOME_BAIRRO", "nm_mun": "MUNICIPIO"}},
                {"name": "renda", "periodo": "2022", "scope": "national", "urls": ["https://ftp.ibge.gov.br/test/2022/renda.zip"],
                 "encoding": "utf-8", "delimiter": ";", "decimal_separator": ",", "member_pattern": "renda*.csv",
                 "columns": {"cd_setor": "CODE", "responsaveis_renda": "PESO", "renda_media_responsavel": "MEDIA"}},
            ],
        }
        self.basic = [
            {"CODE": "420540701000001", "POP": "30", "DOM": "20", "SITU": "1", "BAIRRO": "4205407001", "NOME_BAIRRO": "CENTRO", "MUNICIPIO": "Florianópolis"},
            {"CODE": "420540701000002", "POP": "20", "DOM": "10", "SITU": "1", "BAIRRO": "4205407001", "NOME_BAIRRO": " Centro  ", "MUNICIPIO": "FLORIANÓPOLIS"},
        ]
        self.income = [{"CODE": self.basic[0]["CODE"], "PESO": "10", "MEDIA": "100,50"},
                       {"CODE": self.basic[1]["CODE"], "PESO": "4", "MEDIA": "X"}]
        self.pib_rows = [("4205407", "2021", "37", "Mil Reais", "12345.678"),
                         ("4209102", "2021", "37", "Mil Reais", "X")]
        self.assets, self.calls = {}, []
        self.refresh()

    def refresh(self):
        for name, rows in (("basico", self.basic), ("renda", self.income)):
            path = self.root / f"{name}.zip"
            text = io.StringIO(newline="")
            writer = csv.DictWriter(text, fieldnames=list(rows[0]), delimiter=";")
            writer.writeheader(); writer.writerows(rows)
            with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as package:
                package.writestr(f"CSV/{name}_BR.csv", text.getvalue().encode("utf-8-sig" if name == "basico" else "utf-8"))
            self.assets[f"https://ftp.ibge.gov.br/test/2022/{name}.zip"] = path
        sidra = [{"D1N": "Ano", "D2N": "Município", "D3N": "Variável", "V": "Valor"}]
        sidra += [{"D2C": code, "D1C": year, "D3C": variable, "MN": unit, "V": value}
                  for code, year, variable, unit, value in self.pib_rows]
        path = self.root / "sidra.json"
        path.write_text(json.dumps(sidra), encoding="utf-8")
        self.assets[fetch.SIDRA_PIB_URL.format(uf="42", year="2021")] = path

    def downloaded(self, url, _cache, **_kwargs):
        self.calls.append(url)
        path = self.assets[url]
        return path, {"url": url, "url_final": url, "sha256_local": fetch.sha256_file(path), "bytes": path.stat().st_size}

    def stage(self):
        with patch.object(fetch, "download", side_effect=self.downloaded):
            return fetch.stage(self.profile, ["42"], self.root / "raw", "2021")

    def test_manifest_standard_and_profile_validate_without_duplicating_core(self):
        self.assertEqual(fetch.adapter.IBGEReleaseManifest.from_json(fetch.STANDARD_MANIFEST).periodo_censo, "2022")
        path = self.root / "profile.json"
        path.write_text(json.dumps(self.profile))
        self.assertEqual(fetch.load_source_profile(path), self.profile)
        for key, bad in (("periodo_censo", "2010"), ("domicilios_universo", "DPPO"),
                         ("dictionary_url", "https://ftp.ibge.gov.br/Censos/Censo_Demografico_2010/dicionario.pdf")):
            copy = deepcopy(self.profile); copy[key] = bad
            path.write_text(json.dumps(copy))
            with self.subTest(key=key), self.assertRaises(ValueError):
                fetch.load_source_profile(path)
            with patch.object(fetch, "download", side_effect=AssertionError("Download antes de validar o perfil")):
                with self.assertRaises(ValueError):
                    fetch.stage(copy, ["42"], self.root / "raw", "2021")

    def test_join_staging_and_ingestion_keep_sigilo_zero_and_exact_scope(self):
        sectors, pib, manifest, report = self.stage()
        self.assertEqual(report["status"], "ready")
        self.assertEqual(report["pib_filtered_municipalities"], ["4209102"])
        with sectors.open() as stream:
            rows = list(csv.DictReader(stream, delimiter=";"))
        self.assertEqual([r["POPULACAO"] for r in rows], ["30", "20"])
        self.assertEqual([r["NM_BAIRRO"] for r in rows], ["CENTRO", "CENTRO"])
        self.assertEqual(rows[1]["RENDA_MEDIA_RESPONSAVEL"], "X")
        paths = fetch.adapter.ingest(sectors, pib, fetch.adapter.IBGEReleaseManifest.from_json(manifest), self.root / "processed", "2026-10-26")
        for path in paths:
            fetch.adapter.validate_payload(json.loads(path.read_text()))
        municipality = json.loads((self.root / "processed/municipios/42/4205407.json").read_text())["municipio"]
        self.assertEqual(municipality["indicadores"]["populacao"], 50)
        self.assertEqual(municipality["indicadores"]["domicilios"], 30)
        self.assertEqual(municipality["indicadores"]["renda_media_responsavel"], 100.5)
        self.assertEqual(municipality["indicadores"]["setores_sob_sigilo"], 1)
        self.assertEqual(municipality["indicadores"]["pib_mil_reais_exato"], "12345.678")
        self.income[0]["MEDIA"] = "0"; self.refresh()
        sectors, _, _, _ = self.stage()
        with sectors.open() as stream:
            self.assertEqual(next(csv.DictReader(stream, delimiter=";"))["RENDA_MEDIA_RESPONSAVEL"], "0")

    def test_invalid_demography_situation_and_weights_are_not_repaired(self):
        for table, key, value in ((self.basic, "POP", "X"), (self.basic, "DOM", "X"),
                                  (self.basic, "SITU", "9"), (self.income, "PESO", "500")):
            before = table[0][key]; table[0][key] = value; self.refresh()
            with self.subTest(field=key, value=value), self.assertRaisesRegex(ValueError, "setores inválidos"):
                self.stage()
            run = sorted((self.root / "raw/staging").iterdir(), key=lambda p: p.stat().st_mtime_ns)[-1]
            report = json.loads((run / "report.json").read_text())
            self.assertEqual(report["status"], "failed")
            self.assertEqual(report["invalid_sector_count"], 1)
            self.assertFalse((run / "manifest_ibge.json").exists())
            self.assertEqual(table[0][key], value)
            table[0][key] = before

    def test_real_name_conflicts_fail_instead_of_picking_first_spelling(self):
        self.basic[1]["NOME_BAIRRO"] = "Leste"; self.refresh()
        with self.assertRaisesRegex(ValueError, "setores inválidos"):
            self.stage()
        report = json.loads(next((self.root / "raw/staging").glob("run-*/report.json")).read_text())
        self.assertIn("Nomes territoriais conflitantes", report["invalid_sectors_sample"][0]["reason"])

    def test_missing_gdp_is_an_error_not_an_inner_join(self):
        self.pib_rows = [("4209102", "2021", "37", "Mil Reais", "100")]; self.refresh()
        with self.assertRaisesRegex(ValueError, "sem PIB"):
            self.stage()

    def test_duplicate_or_unmatched_sector_tables_fail(self):
        self.income.append(dict(self.income[0])); self.refresh()
        with self.assertRaisesRegex(ValueError, "duplicado"):
            self.stage()
        self.income = self.income[:1]; self.refresh()
        with self.assertRaisesRegex(ValueError, "Join 1:1 incompleto"):
            self.stage()

    def test_sidra_dimensions_unit_variable_and_period_are_checked(self):
        for column, bad in ((1, "2020"), (2, "999"), (3, "Reais")):
            original = self.pib_rows[0]
            row = list(original); row[column] = bad; self.pib_rows[0] = tuple(row); self.refresh()
            with self.subTest(column=column), self.assertRaisesRegex(ValueError, "SIDRA: período"):
                self.stage()
            self.pib_rows[0] = original

    def test_national_zip_is_read_once_per_table_for_multiple_ufs(self):
        self.basic.append({**self.basic[0], "CODE": "355030801000001", "BAIRRO": "", "NOME_BAIRRO": "", "MUNICIPIO": "SÃO PAULO"})
        self.income.append({**self.income[0], "CODE": "355030801000001"}); self.refresh()
        path = self.root / "sp_sidra.json"
        path.write_text(json.dumps([{"D1N": "Ano", "D2N": "Município", "D3N": "Variável"},
            {"D1C": "2021", "D2C": "3550308", "D3C": "37", "MN": "Mil Reais", "V": "100"}]))
        self.assets[fetch.SIDRA_PIB_URL.format(uf="35", year="2021")] = path
        with patch.object(fetch, "download", side_effect=self.downloaded):
            fetch.stage(self.profile, ["35", "42"], self.root / "raw", "2021")
        self.assertEqual(self.calls.count(self.profile["tables"][0]["urls"][0]), 1)
        self.assertEqual(self.calls.count(self.profile["tables"][1]["urls"][0]), 1)

    def test_water_body_denylist_and_uf_selection(self):
        self.basic.append({**self.basic[0], "CODE": "430000101000001"})
        self.income.append({**self.income[0], "CODE": "430000101000001"}); self.refresh()
        _, _, _, report = self.stage()
        self.assertEqual(report["water_body_rows_filtered"], 2)
        self.assertEqual(fetch.resolve_ufs([" sc ", "42", "SP"]), ["35", "42"])
        self.assertEqual(len(fetch.resolve_ufs(["ALL"])), 27)
        with self.assertRaises(ValueError):
            fetch.resolve_ufs([42])

    def test_dynamic_hosts_are_not_accepted_as_sources(self):
        for host in ("servicodados.ibge.gov.br", "www.ibge.gov.br"):
            with self.assertRaises(ValueError):
                fetch.official_url(f"https://{host}/arquivo.zip")
        self.assertEqual(fetch.official_url("https://geoftp.ibge.gov.br/malhas.zip"), "https://geoftp.ibge.gov.br/malhas.zip")

    def test_removed_mesh_api_fails_before_staging(self):
        with patch.object(fetch.sys, "argv", ["03", "--source-profile", "unused.json", "--download-geojson"]), patch.object(fetch, "stage") as stage:
            with self.assertRaises(SystemExit):
                fetch.main()
            stage.assert_not_called()

    def test_cli_uses_preparation_metadata_without_exporting_national_municipal_lists(self):
        profile_path = self.root / "profile.json"; profile_path.write_text(json.dumps(self.profile))
        argv = ["03", "--source-profile", str(profile_path), "--ufs", "SC",
                "--raw-dir", str(self.root / "raw"), "--output-dir", str(self.root / "processed")]
        with patch.object(fetch.sys, "argv", argv), patch.object(fetch, "download", side_effect=self.downloaded):
            fetch.main()
        root = json.loads((self.root / "processed/brasil.json").read_text())
        self.assertEqual(root["metadata"]["preparacao"]["numero_municipios"], 1)
        self.assertNotIn("municipalities", root["metadata"]["preparacao"])
        self.assertEqual(root["metadata"]["periodo_censo"], "2022")
        self.assertEqual(root["metadata"]["indicadores"]["domicilios"]["universo"], "total_fisico")


class DownloadTests(unittest.TestCase):
    def test_download_integrity_cache_limits_and_https(self):
        with tempfile.TemporaryDirectory() as folder:
            root, url = Path(folder), "https://ftp.ibge.gov.br/test/data.zip"
            class Response(io.BytesIO):
                headers = {"Content-Length": "10"}
                def geturl(self): return url
            with patch.object(fetch.urllib.request, "urlopen", return_value=Response(b"0123456789")) as request:
                path, record = fetch.download(url, root)
                self.assertEqual(record["sha256_local"], hashlib.sha256(b"0123456789").hexdigest())
                self.assertEqual(fetch.download(url, root)[0], path)
                self.assertEqual(request.call_count, 1)
                self.assertNotIn("context", request.call_args.kwargs)  # TLS padrão, sem bypass.
            path.write_bytes(b"corrompido")
            with self.assertRaisesRegex(ValueError, "Cache inconsistente"):
                fetch.download(url, root)
            with self.assertRaises(ValueError):
                fetch.download("http://ftp.ibge.gov.br/test/data.zip", root)

    def test_incomplete_download_does_not_publish_cache_file(self):
        with tempfile.TemporaryDirectory() as folder:
            url = "https://ftp.ibge.gov.br/test/data.zip"
            class Response(io.BytesIO):
                headers = {"Content-Length": "100"}
                def geturl(self): return url
            with patch.object(fetch.urllib.request, "urlopen", return_value=Response(b"short")):
                with self.assertRaisesRegex(ValueError, "incompleto"):
                    fetch.download(url, Path(folder))
            self.assertEqual(list(Path(folder).iterdir()), [])


if __name__ == "__main__":
    unittest.main()
