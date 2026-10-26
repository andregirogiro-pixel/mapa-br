#!/usr/bin/env python3
"""Download oficial e staging 2022 por perfil explícito, sem imputação de dados."""
from __future__ import annotations

import argparse
from dataclasses import asdict, replace
from datetime import datetime, timezone
from decimal import Decimal
import csv
import fnmatch
import hashlib
from html.parser import HTMLParser
import importlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import sqlite3
import sys
import tempfile
import unicodedata
from urllib.parse import urljoin, urlsplit
import urllib.request
import zipfile

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from etl_pipeline.core_contract import normalize_code, WATER_BODY_DENYLIST
from etl_pipeline.reference_data import UFS

adapter = importlib.import_module("etl_pipeline.02_ingest_ibge_real")
UF_BY_CODE = {code: (sigla, name, region) for code, sigla, name, region in UFS}
UF_BY_SIGLA = {sigla: code for code, sigla, _, _ in UFS}
STANDARD_MANIFEST = Path(__file__).parent / "manifests/ibge_padrao.json"
SIDRA_PIB_URL = "https://apisidra.ibge.gov.br/values/t/5938/n6/in%20n3%20{uf}/v/37/p/{year}?formato=json"
TERRITORIAL_FIELDS = {"cd_mun", "cd_uf", "nm_mun", "cd_dist", "nm_dist", "cd_subdist", "nm_subdist", "cd_bairro", "nm_bairro", "situacao_setor"}
NUMERIC_FIELDS = {"populacao", "domicilios", "responsaveis_renda", "renda_media_responsavel", "massa_rendimento_setor"}


def official_url(url: str) -> str:
    parsed = urlsplit(url)
    host = parsed.hostname or ""
    if host in {"servicodados.ibge.gov.br", "www.ibge.gov.br"}:
        raise ValueError("Fonte dinâmica/portal proibida: usar arquivos estáticos FTP do IBGE")
    if parsed.scheme != "https" or not (host == "ibge.gov.br" or host.endswith(".ibge.gov.br")) or parsed.username or parsed.password:
        raise ValueError("A fonte deve ser uma URL HTTPS oficial do IBGE, sem credenciais")
    return url


def atomic_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, suffix=".tmp", delete=False) as stream:
            temp = Path(stream.name)
            json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.write("\n")
        temp.replace(path)
    finally:
        if temp:
            temp.unlink(missing_ok=True)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(url: str, cache_dir: Path, *, timeout: int = 45, max_bytes: int = 2 * 1024**3) -> tuple[Path, dict]:
    """Cache por URL com SHA-256 local; TLS permanece habilitado."""
    official_url(url)
    cache_dir.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha256(url.encode()).hexdigest()
    target, receipt = cache_dir / key, cache_dir / f"{key}.json"
    if target.exists() and receipt.exists():
        record = json.loads(receipt.read_text(encoding="utf-8"))
        if record["url"] != url or record["bytes"] != target.stat().st_size or record["sha256_local"] != sha256_file(target):
            raise ValueError(f"Cache inconsistente: {target}; remova-o e baixe novamente")
        if target.stat().st_size > max_bytes:
            raise ValueError("Cache excede limite de download")
        return target, record
    temp = None
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "MapaBR/3.0 data-ingestion"})
        with urllib.request.urlopen(request, timeout=timeout) as response:
            official_url(response.geturl())
            content_length = response.headers.get("Content-Length")
            if content_length and int(content_length) > max_bytes:
                raise ValueError("Download excede limite de tamanho")
            digest, count = hashlib.sha256(), 0
            with tempfile.NamedTemporaryFile(dir=cache_dir, suffix=".tmp", delete=False) as stream:
                temp = Path(stream.name)
                while chunk := response.read(1024 * 1024):
                    count += len(chunk)
                    if count > max_bytes:
                        raise ValueError("Download excede limite de tamanho")
                    digest.update(chunk)
                    stream.write(chunk)
            if content_length and count != int(content_length):
                raise ValueError("Download incompleto")
            record = {"url": url, "url_final": response.geturl(), "bytes": count,
                      "sha256_local": digest.hexdigest(),
                      "downloaded_at": datetime.now(timezone.utc).isoformat()}
        temp.replace(target)
        atomic_json(receipt, record)
        return target, record
    finally:
        if temp:
            temp.unlink(missing_ok=True)


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.hrefs = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() == "a":
            for key, value in attrs:
                if key.lower() == "href" and value:
                    self.hrefs.append(value)


def resolve_ufs(tokens: list[str]) -> list[str]:
    if not all(isinstance(token, str) for token in tokens):
        raise ValueError("UFs devem ser strings")
    tokens = [token.strip().upper() for token in tokens]
    if tokens == ["ALL"]:
        return sorted(UF_BY_CODE)
    result = set()
    for token in tokens:
        token = token.strip().upper()
        code = token if token in UF_BY_CODE else UF_BY_SIGLA.get(token)
        if code is None:
            raise ValueError(f"UF inválida: {token}")
        result.add(code)
    return sorted(result)


def load_source_profile(path: Path) -> dict:
    return validate_source_profile(json.loads(path.read_text(encoding="utf-8")))


def validate_source_profile(profile: dict) -> dict:
    # O perfil é declaração auditável, não certificado automático de autenticidade.
    for key in ("release_censo", "periodo_censo", "universo_renda", "dictionary_url", "tables"):
        if not profile.get(key):
            raise ValueError(f"Perfil sem {key}")
    for key in ("release_censo", "periodo_censo", "universo_renda", "dictionary_url"):
        if not isinstance(profile[key], str) or not profile[key].strip():
            raise ValueError(f"Perfil: {key} deve ser textual")
    if profile["periodo_censo"] != "2022":
        raise ValueError("Este automatizador foi solicitado para Censo 2022; não rotular 2010 como 2022")
    official_url(profile["dictionary_url"])
    if "censo_demografico_2010" in profile["dictionary_url"].casefold():
        raise ValueError("Dicionário 2010 não valida uma publicação 2022")
    if not isinstance(profile["tables"], list) or not profile["tables"]:
        raise ValueError("Perfil precisa de tabelas brutas")
    fields = set()
    for table in profile["tables"]:
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", table.get("name", "")):
            raise ValueError("Nome interno de tabela inválido")
        if table.get("periodo") != profile["periodo_censo"]:
            raise ValueError("Não misturar edições censitárias em um único universo")
        for key in ("encoding", "delimiter", "decimal_separator", "member_pattern", "columns"):
            if not table.get(key):
                raise ValueError(f"Tabela sem {key}")
        if table.get("scope", "uf") not in {"uf", "national"}:
            raise ValueError("scope deve ser uf ou national")
        if table.get("scope") == "national" and any(token in table["member_pattern"] for token in ("{uf}", "{sigla}")):
            raise ValueError("Padrão de membro nacional deve abranger todas as UFs, sem placeholder UF")
        if len(table["delimiter"]) != 1 or table["decimal_separator"] not in {",", "."}:
            raise ValueError("Formato CSV bruto inválido")
        columns = table["columns"]
        if not isinstance(columns, dict) or "cd_setor" not in columns:
            raise ValueError("Toda tabela precisa mapear cd_setor")
        if set(columns) - TERRITORIAL_FIELDS - NUMERIC_FIELDS - {"cd_setor"}:
            raise ValueError("Mapeamento bruto contém campo desconhecido")
        if any(not isinstance(v, str) or not v.strip() for v in columns.values()) or len(set(columns.values())) != len(columns):
            raise ValueError("Colunas brutas devem ser textuais, preenchidas e distintas")
        overlap = fields & (set(columns) - {"cd_setor"})
        if overlap:
            raise ValueError(f"Campo mapeado por mais de uma tabela: {sorted(overlap)}")
        fields |= set(columns)
        sources = table.get("urls") or [table.get("directory_url")]
        for url in sources:
            if not url:
                raise ValueError("Informar urls ou directory_url para cada tabela")
            official_url(url)
            if "censo_demografico_2010" in url.casefold():
                raise ValueError("Endpoint 2010 não é fonte para o perfil 2022")
    required = {"populacao", "domicilios", "responsaveis_renda", "situacao_setor"}
    if not required <= fields or not fields & {"renda_media_responsavel", "massa_rendimento_setor"}:
        raise ValueError("Perfil incompleto: mapear demografia, universo, situação e renda")
    if profile.get("domicilios_universo") != "total_fisico":
        raise ValueError("domicilios deve vir do total físico; DPPO não pode ser renomeado como total")
    return profile


def table_urls(table: dict, uf: str, cache: Path) -> list[str]:
    values = {"uf": uf, "sigla": UF_BY_CODE[uf][0]}
    if table.get("urls"):
        urls = [url.format(**values) for url in table["urls"]]
    else:
        directory = table["directory_url"].format(**values)
        path, _ = download(directory, cache, max_bytes=8 * 1024**2)
        parser = Links()
        parser.feed(path.read_text(encoding=table.get("directory_encoding", "utf-8")))
        pattern = table.get("archive_pattern", "{sigla}_*.zip").format(**values)
        urls = []
        for href in parser.hrefs:
            url = urljoin(directory, href)
            if not url.startswith(directory):
                continue
            if fnmatch.fnmatchcase(PurePosixPath(urlsplit(url).path).name.upper(), pattern.upper()):
                urls.append(url)
    if not urls:
        raise ValueError(f"Nenhum arquivo da tabela {table['name']} para {uf}")
    return sorted(set(urls))


def iter_raw_csv(archive: Path, pattern: str, table: dict):
    """Lê sem extrair caminhos do ZIP e sem inferência/tolerância de encoding."""
    with zipfile.ZipFile(archive) as package:
        members = [i for i in package.infolist() if not i.is_dir() and
                   fnmatch.fnmatchcase(PurePosixPath(i.filename).name.upper(), pattern.upper())]
        for member in sorted(members, key=lambda i: i.filename):
            if member.file_size > 4 * 1024**3:
                raise ValueError("Membro CSV excede limite de 4 GiB")
            with package.open(member) as binary, io.TextIOWrapper(binary, encoding=table["encoding"], errors="strict", newline="") as stream:
                reader = csv.DictReader(stream, delimiter=table["delimiter"], strict=True)
                headers = reader.fieldnames or []
                if len(headers) != len(set(headers)) or not set(table["columns"].values()) <= set(headers):
                    raise ValueError(f"Cabeçalho incompatível: {member.filename}")
                for number, row in enumerate(reader, 2):
                    if None in row or any(v is None for v in row.values()):
                        raise ValueError(f"CSV irregular: {member.filename}:{number}")
                    yield member.filename, number, row


def clean_name(text: str) -> str:
    # Caixa/Unicode/espaços são normalizados; acentos não são removidos e
    # mojibake não é corrigido por adivinhação.
    return unicodedata.normalize("NFC", " ".join(text.split())).upper()


def _dimension(header: dict, label: str) -> str:
    def label_key(s):
        return "".join(c for c in unicodedata.normalize("NFD", s.casefold()) if not unicodedata.combining(c))
    for key, value in header.items():
        if re.fullmatch(r"D[0-9]+N", key) and label_key(value) == label:
            return key[:-1] + "C"
    raise ValueError(f"Cabeçalho SIDRA sem dimensão {label}")


def fetch_pib_sidra_for_ufs(ufs: list[str], year: str, cache: Path, municipalities: set[str]) -> tuple[dict[str, str], list[dict], list[str]]:
    """Filtra somente extras do PIB; município censitário sem PIB é erro."""
    if not re.fullmatch(r"[0-9]{4}", year):
        raise ValueError("Ano do PIB deve ser explícito, com quatro dígitos")
    result, receipts, filtered = {}, [], set()
    for uf in ufs:
        path, receipt = download(SIDRA_PIB_URL.format(uf=uf, year=year), cache, max_bytes=32 * 1024**2)
        receipts.append(receipt)
        raw = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, list) or len(raw) < 2 or not isinstance(raw[0], dict):
            raise ValueError("SIDRA retornou erro ou resultado vazio")
        municipality_field = _dimension(raw[0], "municipio")
        year_field, variable_field = _dimension(raw[0], "ano"), _dimension(raw[0], "variavel")
        seen = set()
        for row in raw[1:]:
            code = normalize_code(row[municipality_field], "cd_mun")
            if code in WATER_BODY_DENYLIST:
                continue
            if not code.startswith(uf) or code in seen:
                raise ValueError(f"Município SIDRA duplicado ou fora da UF: {code}")
            seen.add(code)
            if row[year_field] != year or row[variable_field] != "37" or clean_name(row.get("MN", "")) != "MIL REAIS":
                raise ValueError("SIDRA: período, variável ou unidade diferente do solicitado")
            if code not in municipalities:
                filtered.add(code)
                continue
            value, status = adapter.parse_ibge_numeric(row["V"], field="pib_mil_reais", decimal_sep=".")
            if status != "divulgada":
                raise ValueError(f"PIB indisponível: {code}")
            result[code] = format(value, "f")
    if municipalities - result.keys():
        raise ValueError(f"Municípios censitários sem PIB: {sorted(municipalities - result.keys())}")
    return result, receipts, sorted(filtered)


def stage(profile: dict, ufs: list[str], raw_dir: Path, pib_year: str) -> tuple[Path, Path, Path, dict]:
    validate_source_profile(profile)
    if not isinstance(pib_year, str) or not re.fullmatch(r"[0-9]{4}", pib_year):
        raise ValueError("Ano do PIB deve ser explícito, com quatro dígitos")
    cache, runs = raw_dir / "cache", raw_dir / "staging"
    runs.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix="run-", dir=runs))
    report = {"release_censo": profile["release_censo"], "periodo_censo": "2022", "periodo_pib": pib_year,
              "dictionary_url": profile["dictionary_url"], "ufs": ufs, "sources": [],
              "water_body_rows_filtered": 0, "out_of_scope_rows": 0,
              "invalid_sector_count": 0, "invalid_sectors_sample": [],
              "invalid_sectors_file": "invalid_sectors.csv", "status": "staging"}
    report["massa_origem"] = "Publicada quando mapeada; caso contrário reconstruída da média, herdando seu arredondamento"
    standard = adapter.IBGEReleaseManifest.from_json(STANDARD_MANIFEST)
    fields = set().union(*(set(t["columns"]) for t in profile["tables"]))
    mapping = {field: (column if field in fields or field.startswith("cd_") else None)
               for field, column in standard.col_map_setor.items()}
    for field in ("renda_media_responsavel", "massa_rendimento_setor"):
        mapping[field] = field.upper() if field in fields else None
    manifest = replace(standard, release_censo=profile["release_censo"], periodo_censo="2022",
                       periodo_pib=pib_year, universo_renda=profile["universo_renda"], col_map_setor=mapping)
    report_path = staging / "report.json"
    sectors_csv, pib_csv, manifest_path = staging / "setores_staged.csv", staging / "pib_staged.csv", staging / "manifest_ibge.json"
    try:
        with tempfile.TemporaryDirectory(prefix="mapa-br-staging-") as temp:
            with sqlite3.connect(Path(temp) / "join.sqlite") as db:
                db.execute("CREATE TABLE raw (part INTEGER, code TEXT, payload TEXT, PRIMARY KEY(part,code))")
                db.execute("CREATE TABLE names (field TEXT, code TEXT, name TEXT, PRIMARY KEY(field,code))")
                municipalities, selected_ufs = set(), frozenset(ufs)
                for part, table in enumerate(profile["tables"]):
                    downloaded, counts = set(), {uf: 0 for uf in ufs}
                    for uf in ufs:
                        for url in table_urls(table, uf, cache):
                            if url in downloaded:
                                continue
                            downloaded.add(url)
                            archive, receipt = download(url, cache)
                            report["sources"].append(receipt)
                            pattern = table["member_pattern"].format(uf=uf, sigla=UF_BY_CODE[uf][0])
                            for member, line, source in iter_raw_csv(archive, pattern, table):
                                code = normalize_code(source[table["columns"]["cd_setor"]], "cd_setor")
                                if code[:7] in WATER_BODY_DENYLIST:
                                    report["water_body_rows_filtered"] += 1
                                    continue
                                if table.get("scope", "uf") == "national":
                                    if code[:2] not in selected_ufs:
                                        report["out_of_scope_rows"] += 1
                                        continue
                                elif not code.startswith(uf):
                                    raise ValueError(f"Setor fora da UF {uf}: {code}")
                                values = {"cd_setor": code}
                                for field, column in table["columns"].items():
                                    if field == "cd_setor":
                                        continue
                                    value = source[column]
                                    if field in NUMERIC_FIELDS:
                                        try:
                                            parsed, status = adapter.parse_ibge_numeric(value, field=field,
                                                decimal_sep=table["decimal_separator"], as_integer=field in {"populacao", "domicilios", "responsaveis_renda"}, allow_sigilo=True)
                                        except ValueError as exc:
                                            raise ValueError(f"{table['name']}/{member}:{line}, setor {code}: {exc}") from exc
                                        value = "X" if status == "sigilo" else "" if status == "ausente" else format(parsed, "f") if isinstance(parsed, Decimal) else str(parsed)
                                    elif field.startswith("nm_"):
                                        value = clean_name(value)
                                    else:
                                        value = value.strip()
                                    values[field] = value
                                try:
                                    db.execute("INSERT INTO raw VALUES (?,?,?)", (part, code, json.dumps(values, ensure_ascii=False)))
                                    counts[code[:2]] += 1
                                except sqlite3.IntegrityError as exc:
                                    raise ValueError(f"Setor duplicado em {table['name']}/{member}:{line}: {code}") from exc
                    for uf in ufs:
                        if counts[uf] == 0:
                            raise ValueError(f"Nenhum setor na tabela {table['name']} para {uf}")
                db.commit()
                rows = db.execute("SELECT code,part,payload FROM raw ORDER BY code,part")
                current, parts = None, []
                with sectors_csv.open("w", encoding="utf-8", newline="") as stream, (staging / "invalid_sectors.csv").open("w", encoding="utf-8", newline="") as errors:
                    writer = csv.DictWriter(stream, fieldnames=[v for v in manifest.col_map_setor.values() if v], delimiter=";")
                    writer.writeheader()
                    error_writer = csv.writer(errors, delimiter=";")
                    error_writer.writerow(["CD_SETOR", "MOTIVO"])

                    def emit(code, rows):
                        if len(rows) != len(profile["tables"]):
                            raise ValueError(f"Join 1:1 incompleto nas tabelas: {code}")
                        internal = {key: value for row in rows for key, value in row.items()}
                        internal.setdefault("cd_mun", code[:7]); internal.setdefault("cd_uf", code[:2])
                        internal.setdefault("cd_dist", code[:9]); internal.setdefault("cd_subdist", code[:11])
                        normalized = {column: internal.get(field, "") for field, column in manifest.col_map_setor.items() if column}
                        try:
                            sector = adapter.adapt_sector(normalized, manifest)
                            for field in ("nm_mun", "nm_dist", "nm_subdist", "nm_bairro"):
                                name = sector[field]
                                identity = sector[field.replace("nm_", "cd_")]
                                if not name or not identity:
                                    continue
                                previous = db.execute("SELECT name FROM names WHERE field=? AND code=?", (field, identity)).fetchone()
                                if previous and previous[0] != name:
                                    raise ValueError(f"Nomes territoriais conflitantes: {field}/{identity}: {previous[0]!r} / {name!r}")
                                db.execute("INSERT OR IGNORE INTO names VALUES (?,?,?)", (field, identity, name))
                        except (ValueError, TypeError) as exc:
                            report["invalid_sector_count"] += 1
                            error_writer.writerow([code, str(exc)])
                            if len(report["invalid_sectors_sample"]) < 20:
                                report["invalid_sectors_sample"].append({"cd_setor": code, "reason": str(exc)})
                            return
                        municipalities.add(sector["cd_mun"])
                        writer.writerow(normalized)

                    for code, part, text in rows:
                        if current is not None and current != code:
                            emit(current, parts); parts = []
                        current = code; parts.append(json.loads(text))
                    if current is not None:
                        emit(current, parts)
                if report["invalid_sector_count"]:
                    raise ValueError(f"{report['invalid_sector_count']} setores inválidos: conferir {report_path}; nenhuma publicação permitida")
                if not municipalities:
                    raise ValueError("Nenhum município válido após staging")
                pib, receipts, filtered = fetch_pib_sidra_for_ufs(ufs, pib_year, cache, municipalities)
                report.update(pib_filtered_municipalities=filtered, municipalities=sorted(municipalities))
                report["sources"].extend(receipts)
                with pib_csv.open("w", encoding="utf-8", newline="") as stream:
                    writer = csv.writer(stream, delimiter=";"); writer.writerow(["CD_MUN", "PIB_MIL_REAIS"])
                    writer.writerows(sorted(pib.items()))
                atomic_json(manifest_path, asdict(manifest))
                report["status"] = "ready"
    except Exception as exc:
        report.update(status="failed", error=str(exc))
        atomic_json(report_path, report)
        raise
    atomic_json(report_path, report)
    return sectors_csv, pib_csv, manifest_path, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-profile", type=Path, required=True, help="Perfil verificado dos arquivos/colunas da publicação 2022")
    parser.add_argument("--ufs", nargs="+", default=["42", "35"])
    parser.add_argument("--raw-dir", type=Path, default=Path(__file__).resolve().parents[1] / "data/raw")
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).resolve().parents[1] / "data/processed_real")
    parser.add_argument("--pib-year", default="2021")
    parser.add_argument("--stage-only", action="store_true")
    parser.add_argument("--download-geojson", action=argparse.BooleanOptionalAction, default=False,
                        help="Obsoleto: malhas reais exigem fonte estática FTP e auditoria separada")
    args = parser.parse_args()
    if args.download_geojson:
        parser.error("API de Malhas removida. Use arquivos estáticos FTP e auditoria geométrica separada.")
    profile, ufs = load_source_profile(args.source_profile), resolve_ufs(args.ufs)
    # Não misturar uma nova execução com JSONs antigos de outro recorte.
    if not args.stage_only and args.output_dir.exists() and any(args.output_dir.iterdir()):
        parser.error("output-dir precisa ser novo/vazio; preserve as fixtures e releases anteriores")
    sectors, pib, manifest_path, report = stage(profile, ufs, args.raw_dir, args.pib_year)
    if args.stage_only:
        print(f"Staging pronto: {manifest_path}; ingestão não executada")
        return
    provenance = {
        "dictionary_url": profile["dictionary_url"],
        "perfil_sha256_local": sha256_file(args.source_profile),
        "relatorio_sha256_local": sha256_file(manifest_path.parent / "report.json"),
        "numero_municipios": len(report["municipalities"]),
        "invalid_sector_count": 0,
        "domicilios_universo": profile["domicilios_universo"],
        "massa_origem": report["massa_origem"],
    }
    paths = adapter.ingest(sectors, pib, adapter.IBGEReleaseManifest.from_json(manifest_path), args.output_dir,
                           datetime.now(timezone.utc).date().isoformat(), preparation=provenance)
    print(f"Publicados {len(paths)} arquivos em {args.output_dir}")


if __name__ == "__main__":
    main()
