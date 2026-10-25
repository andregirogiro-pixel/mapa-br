#!/usr/bin/env python3
"""Adaptador offline de arquivos IBGE locais, parametrizado por release."""
from __future__ import annotations

import argparse
import csv
from dataclasses import asdict, dataclass, replace
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
import json
from pathlib import Path
import re
import sqlite3
import sys
import tempfile

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from etl_pipeline.core_contract import (
    normalize_code, validate_code, nonnegative, aggregate_sectors,
    aggregate_summaries, validate_payload, write_payload,
    validate_sector_invariants, indicators_from_totals,
)
from etl_pipeline.reference_data import UFS, REGIOES, common_metadata

SIGILO_MARKERS = {"X", "x"}
AUSENTE_MARKERS = {"", "..", "...", "-", "NA", "N/A", "NULL", "None"}
# Elementos cartográficos de águas estaduais, não municípios.
WATER_BODY_DENYLIST = frozenset({"4300001", "4300002"})
REQUIRED_SECTOR_FIELDS = {
    "cd_setor", "cd_mun", "situacao_setor", "populacao", "domicilios", "responsaveis_renda",
}
OPTIONAL_SECTOR_FIELDS = {
    "cd_uf", "nm_mun", "cd_dist", "nm_dist", "cd_subdist", "nm_subdist",
    "cd_bairro", "nm_bairro", "renda_media_responsavel", "massa_rendimento_setor",
}


@dataclass(frozen=True)
class IBGEReleaseManifest:
    release_censo: str
    periodo_censo: str
    periodo_pib: str
    universo_renda: str
    csv_encoding: str
    csv_delimiter: str
    decimal_separator: str
    col_map_setor: dict[str, str | None]
    col_map_pib_mun: dict[str, str]
    parquet_decimal_separator: str = "."

    def __post_init__(self):
        for key in ("release_censo", "periodo_censo", "periodo_pib", "universo_renda", "csv_encoding"):
            if not isinstance(getattr(self, key), str) or not getattr(self, key).strip():
                raise ValueError(f"Manifesto: {key} deve ser texto preenchido")
        if self.decimal_separator not in {",", "."}:
            raise ValueError("decimal_separator deve ser vírgula ou ponto")
        if self.parquet_decimal_separator not in {",", "."}:
            raise ValueError("parquet_decimal_separator deve ser vírgula ou ponto")
        if not isinstance(self.csv_delimiter, str) or len(self.csv_delimiter) != 1:
            raise ValueError("csv_delimiter deve ter um caractere")
        for mapping in (self.col_map_setor, self.col_map_pib_mun):
            if not isinstance(mapping, dict):
                raise TypeError("Mapeamentos devem ser objetos JSON")
            values = [v for v in mapping.values() if v is not None]
            if any(not isinstance(v, str) or not v.strip() for v in values):
                raise ValueError("Nomes de colunas devem ser strings preenchidas")
            if len(set(values)) != len(values):
                raise ValueError("Uma coluna não pode representar dois campos internos")
        if not REQUIRED_SECTOR_FIELDS <= self.col_map_setor.keys() or any(
                not self.col_map_setor[k] for k in REQUIRED_SECTOR_FIELDS):
            raise ValueError("Manifesto sem mapeamento dos campos setoriais obrigatórios")
        if self.col_map_setor.keys() - REQUIRED_SECTOR_FIELDS - OPTIONAL_SECTOR_FIELDS:
            raise ValueError("Campo interno setorial desconhecido no manifesto")
        if not any(self.col_map_setor.get(k) for k in
                   ("renda_media_responsavel", "massa_rendimento_setor")):
            raise ValueError("Mapear pelo menos média ou massa de renda")
        if set(self.col_map_pib_mun) != {"cd_mun", "pib_mil_reais"} or any(
                not v for v in self.col_map_pib_mun.values()):
            raise ValueError("PIB exige cd_mun e pib_mil_reais")

    @classmethod
    def from_json(cls, path: Path) -> IBGEReleaseManifest:
        return cls(**json.loads(path.read_text(encoding="utf-8")))


def parse_ibge_numeric(raw_value: str | int | float | Decimal | None, *, field: str, decimal_sep: str = ",",
                       as_integer: bool = False, allow_sigilo: bool = False) -> tuple[int | Decimal | None, str]:
    """Retorna (int/Decimal/None, status), preservando a precisão monetária."""
    if decimal_sep not in {",", "."}:
        raise ValueError("Separador decimal inválido")
    if raw_value is None:
        return None, "ausente"
    if isinstance(raw_value, bool) or not isinstance(raw_value, (str, int, float, Decimal)):
        raise ValueError(f"{field}: tipo numérico inválido")
    text = str(raw_value).strip()
    if text in SIGILO_MARKERS:
        if not allow_sigilo:
            raise ValueError(f"{field}: sigilo não permitido neste campo")
        return None, "sigilo"
    if text in AUSENTE_MARKERS:
        return None, "ausente"
    # Locale se aplica ao texto do CSV, não a números nativos do Parquet.
    if isinstance(raw_value, str) and decimal_sep == ",":
        if "." in text:
            raise ValueError(f"{field}: separador de milhar '.' proibido: {text!r}")
        text = text.replace(",", ".")
    try:
        number = Decimal(text)
    except InvalidOperation as exc:
        raise ValueError(f"{field}: valor numérico malformado: {text!r}") from exc
    if not number.is_finite() or number < 0:
        raise ValueError(f"{field}: valor deve ser finito e não negativo")
    if not re.fullmatch(r"[+\-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+\-]?[0-9]+)?", text):
        raise ValueError(f"{field}: formato numérico inválido")
    if as_integer:
        if number != number.to_integral_value():
            raise ValueError(f"{field}: esperado inteiro exato")
        return int(number), "divulgada"
    return number, "divulgada"


def iter_source_rows(path: Path, mapping: dict, manifest: IBGEReleaseManifest):
    """Valida cabeçalho/schema antes da primeira linha; não infere tipos CSV."""
    required = {name for name in mapping.values() if name is not None}
    if path.suffix.lower() == ".parquet":
        try:
            import pyarrow as pa
            import pyarrow.parquet as pq
        except ImportError as exc:
            raise RuntimeError("Parquet requer pyarrow; instale requirements.txt") from exc
        parquet = pq.ParquetFile(path)
        schema = parquet.schema_arrow
        if len(set(schema.names)) != len(schema.names) or not required <= set(schema.names):
            raise ValueError("Schema Parquet duplicado ou sem colunas mapeadas")
        code_columns = {v for k, v in mapping.items() if k.startswith("cd_") and v}
        code_columns |= {name for name in schema.names if name.lower().startswith("cd_")}
        for name in code_columns:
            kind = schema.field(name).type
            if not (pa.types.is_string(kind) or pa.types.is_large_string(kind)):
                raise TypeError(f"Parquet: código {name} deve ser string, não {kind}")
        for field in ("renda_media_responsavel", "massa_rendimento_setor", "pib_mil_reais"):
            name = mapping.get(field)
            if name:
                kind = schema.field(name).type
                if not (pa.types.is_string(kind) or pa.types.is_large_string(kind) or pa.types.is_decimal(kind)):
                    raise TypeError(f"Parquet: moeda {name} exige string ou decimal128/256, não {kind}")
        for batch in parquet.iter_batches(batch_size=8192, columns=sorted(required)):
            yield from batch.to_pylist()
        return
    if path.suffix.lower() != ".csv":
        raise ValueError("Fonte deve ser CSV ou Parquet")
    with path.open(encoding=manifest.csv_encoding, newline="") as stream:
        reader = csv.DictReader(stream, delimiter=manifest.csv_delimiter, strict=True)
        fields = reader.fieldnames or []
        if len(set(fields)) != len(fields) or not required <= set(fields):
            raise ValueError("Cabeçalho CSV duplicado ou sem colunas mapeadas")
        for row in reader:
            if None in row or any(value is None for value in row.values()):
                raise ValueError(f"Linha CSV irregular em {path.name}:{reader.line_num}")
            yield row


def clean_text(value) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        raise TypeError("Campo territorial textual não pode ser numérico")
    text = value.strip()
    return "" if text in AUSENTE_MARKERS else text


def macro_situation(value) -> str:
    text = clean_text(value).upper()
    if text in {"1", "2", "3"} or text.startswith("URB"):
        return "urbano"
    if text in {"4", "5", "6", "7", "8"} or text.startswith("RUR"):
        return "rural"
    raise ValueError(f"Situação setorial desconhecida: {value!r}")


def adapt_sector(raw: dict, manifest: IBGEReleaseManifest) -> dict | None:
    def get(field):
        column = manifest.col_map_setor.get(field)
        return raw[column] if column else None

    municipality = normalize_code(get("cd_mun"), "cd_mun")
    if municipality in WATER_BODY_DENYLIST:
        return None
    code = normalize_code(get("cd_setor"), "cd_setor")
    if not code.startswith(municipality):
        raise ValueError("Setor incompatível com município")
    for field, expected in (("cd_uf", code[:2]), ("cd_dist", code[:9]), ("cd_subdist", code[:11])):
        explicit = get(field)
        if explicit is not None and clean_text(explicit):
            if normalize_code(explicit, field) != expected:
                raise ValueError(f"{field} diverge do prefixo do setor")
    bairro = clean_text(get("cd_bairro"))
    if not bairro or bairro == "0" or bairro.endswith("000"):
        bairro = None
    else:
        bairro = normalize_code(bairro, "cd_bairro")
        if not bairro.startswith(municipality):
            raise ValueError("Bairro incompatível com município")
    result = {"cd_setor": code, "cd_mun": municipality, "cd_bairro": bairro,
              "nm_bairro": clean_text(get("nm_bairro")), "nm_mun": clean_text(get("nm_mun")),
              "cd_dist": code[:9], "cd_subdist": code[:11],
              "nm_dist": clean_text(get("nm_dist")), "nm_subdist": clean_text(get("nm_subdist")),
              "macro_situacao": macro_situation(get("situacao_setor"))}
    for field in ("populacao", "domicilios", "responsaveis_renda"):
        value, status = parse_ibge_numeric(get(field), field=field,
            decimal_sep=manifest.decimal_separator, as_integer=True,
            allow_sigilo=field == "responsaveis_renda")
        if field == "responsaveis_renda":
            weight_status = status
        elif status != "divulgada":
            raise ValueError(f"{field} obrigatório e divulgado")
        result[field] = value
    statuses = []
    for field in ("renda_media_responsavel", "massa_rendimento_setor"):
        value, status = parse_ibge_numeric(get(field), field=field,
            decimal_sep=manifest.decimal_separator, allow_sigilo=True)
        result[field] = value
        if manifest.col_map_setor.get(field):
            statuses.append(status)
    if len(set(statuses)) > 1:
        raise ValueError("Status contraditórios entre massa e média mapeadas")
    if weight_status == "sigilo":
        # Se apenas uma medida é mapeada, é ela que deve estar sob sigilo.
        if not statuses or any(s != "sigilo" for s in statuses):
            raise ValueError("Denominador sob sigilo exige todas as medidas mapeadas sob sigilo")
        result["responsaveis_renda"] = 0
        result["universo_renda_suprimido"] = True
    elif weight_status != "divulgada":
        raise ValueError("responsaveis_renda ausente não pode ser inferido")
    result["status_renda"] = ("divulgada" if "divulgada" in statuses else
                              "sigilo" if "sigilo" in statuses else "ausente")
    validate_sector_invariants(result)
    return result


def group_municipality_sectors(setores: list[dict], *, cd_mun: str) -> list[dict]:
    groups = {}
    for sector in setores:
        if sector["cd_mun"] != cd_mun:
            raise ValueError("Grupo contém setor de outro município")
        key = (("oficial", sector["cd_bairro"]) if sector["cd_bairro"] else
               ("fallback", sector["cd_subdist"], sector["macro_situacao"]))
        groups.setdefault(key, []).append(sector)
    bairros = []
    for key, members in sorted(groups.items()):
        first = members[0]
        if key[0] == "oficial":
            names = {s["nm_bairro"] for s in members if s["nm_bairro"]}
            if len(names) > 1:
                raise ValueError("Nome de bairro conflitante para o mesmo código")
            name = next(iter(names), f"Bairro {key[1]}")
            bairro, group_id = key[1], f"bairro:{key[1]}"
        else:
            use_subdistrict = key[1][9:11] != "00"
            field = "nm_subdist" if use_subdistrict else "nm_dist"
            names = {s[field] for s in members if s[field]}
            if len(names) > 1:
                raise ValueError("Nome administrativo conflitante no agrupamento")
            label = "Urbano" if key[2] == "urbano" else "Rural"
            if use_subdistrict and names:
                title = next(iter(names))
            else:
                district_names = {s["nm_dist"] for s in members if s["nm_dist"]}
                if len(district_names) > 1:
                    raise ValueError("Nome de distrito conflitante")
                title = f"Distrito {next(iter(district_names), first['cd_dist'])}"
            name = f"{title} ({label} - Setores Agregados)"
            bairro, group_id = None, f"subdist:{key[1]}:{key[2]}"
        bairros.append(aggregate_sectors(members, cd_mun=cd_mun, cd_bairro=bairro,
                                        id_agregacao=group_id, nm_bairro=name))
    return sorted(bairros, key=lambda b: (0 if b["cd_bairro"] else 1, b["id_agregacao"]))


def release_metadata(manifest, updated_at, sector_path, gdp_path):
    metadata = common_metadata(updated_at)
    metadata.update(tipo_dados="fonte_ibge_declarada", aviso="Dados de arquivos locais; release declarada no manifesto.",
        release_censo=manifest.release_censo, universo_renda=manifest.universo_renda,
        mapeamento_variaveis_censo=manifest.col_map_setor,
        mapeamento_variaveis_pib=manifest.col_map_pib_mun,
        periodo_censo=manifest.periodo_censo, periodo_pib=manifest.periodo_pib,
        fontes={"setores": sector_path.name, "pib": gdp_path.name},
        cobertura_territorial="recorte_dos_arquivos_de_entrada", manifesto=asdict(manifest))
    for name, info in metadata["indicadores"].items():
        info.update(periodo_referencia=(manifest.periodo_pib if name.startswith("pib_") else manifest.periodo_censo),
                    fonte=manifest.release_censo if not name.startswith("pib_") else "PIB municipal: arquivo declarado")
    metadata["indicadores"]["pib_per_capita"].update(
        metodo="PIB da tabela municipal / população dos setores fornecidos",
        periodo_populacao=manifest.periodo_censo)
    return metadata


def ingest(sector_path: Path, gdp_path: Path, manifest: IBGEReleaseManifest,
           output_dir: Path, updated_at: str) -> list[Path]:
    """Estagia em SQLite (disco); mantém só um município e resumos em memória."""
    date.fromisoformat(updated_at)
    metadata = release_metadata(manifest, updated_at, sector_path, gdp_path)
    gdp_by_mun = {}
    # Locale textual é independente entre CSV e Parquet.
    sector_manifest = (replace(manifest, decimal_separator=manifest.parquet_decimal_separator)
                       if sector_path.suffix.lower() == ".parquet" else manifest)
    gdp_separator = (manifest.parquet_decimal_separator if gdp_path.suffix.lower() == ".parquet"
                     else manifest.decimal_separator)
    for row in iter_source_rows(gdp_path, manifest.col_map_pib_mun, manifest):
        code = normalize_code(row[manifest.col_map_pib_mun["cd_mun"]], "cd_mun")
        if code in WATER_BODY_DENYLIST:
            continue
        value, status = parse_ibge_numeric(row[manifest.col_map_pib_mun["pib_mil_reais"]],
            field="pib_mil_reais", decimal_sep=gdp_separator)
        if status != "divulgada" or code in gdp_by_mun:
            raise ValueError(f"PIB ausente ou código duplicado: {code}")
        gdp_by_mun[code] = value
    paths, uf_summaries = [], {}
    uf_registry = {code: (sigla, name, region) for code, sigla, name, region in UFS}
    with tempfile.TemporaryDirectory(prefix="mapa-br-ingest-") as temp:
        with sqlite3.connect(Path(temp) / "sectors.sqlite") as db:
            db.execute("CREATE TABLE sectors (code TEXT PRIMARY KEY, mun TEXT NOT NULL, data TEXT NOT NULL)")
            db.execute("CREATE INDEX sector_mun ON sectors(mun)")
            for number, row in enumerate(iter_source_rows(sector_path, manifest.col_map_setor, manifest), 2):
                try:
                    sector = adapt_sector(row, sector_manifest)
                    if sector is None:
                        continue
                    if sector["cd_mun"][:2] not in uf_registry:
                        raise ValueError("UF desconhecida")
                    db.execute("INSERT INTO sectors VALUES (?, ?, ?)", (
                        sector["cd_setor"], sector["cd_mun"], json.dumps(sector, default=str)))
                except (ValueError, TypeError, sqlite3.IntegrityError) as exc:
                    raise ValueError(f"Setores, registro {number}: {exc}") from exc
            db.commit()
            municipalities = [r[0] for r in db.execute("SELECT DISTINCT mun FROM sectors ORDER BY mun")]
            if not municipalities:
                raise ValueError("Nenhum município válido nos setores")
            missing = set(municipalities) - gdp_by_mun.keys()
            extra = gdp_by_mun.keys() - set(municipalities)
            if missing or extra:
                raise ValueError(f"Integridade referencial PIB/Censo: sem PIB={sorted(missing)}, sem Censo={sorted(extra)}")
            for code in municipalities:
                sectors = []
                for (text,) in db.execute("SELECT data FROM sectors WHERE mun=? ORDER BY code", (code,)):
                    sector = json.loads(text)
                    for field in ("renda_media_responsavel", "massa_rendimento_setor"):
                        if sector[field] is not None:
                            sector[field] = Decimal(sector[field])
                    sectors.append(sector)
                bairros = group_municipality_sectors(sectors, cd_mun=code)
                totals = aggregate_sectors(sectors, cd_mun=code, id_agregacao=f"municipio:{code}", nm_bairro=code)
                for field in ("populacao", "domicilios", "responsaveis_renda", "responsaveis_com_renda"):
                    if sum(b[field] for b in bairros) != totals[field]:
                        raise ValueError(f"Reconciliação falhou: {code}/{field}")
                if sum((Decimal(b["massa_rendimento_considerada"]) for b in bairros), Decimal(0)) != Decimal(totals["massa_rendimento_considerada"]):
                    raise ValueError(f"Reconciliação de massa falhou: {code}")
                indicators = indicators_from_totals(totals, gdp_by_mun[code])
                names = {s["nm_mun"] for s in sectors if s["nm_mun"]}
                if len(names) > 1:
                    raise ValueError(f"Nomes municipais conflitantes: {code}")
                name = next(iter(names), f"Município {code}")
                uf = code[:2]
                path = output_dir / "municipios" / uf / f"{code}.json"
                write_payload(path, {"metadata": {**metadata, "nivel": "municipio", "cd_uf": uf, "cd_mun": code},
                    "municipio": {"cd_mun": code, "nm_mun": name, "indicadores": indicators, "bairros": bairros}})
                paths.append(path)
                uf_summaries.setdefault(uf, []).append({"cd_mun": code, "nm_mun": name,
                    "indicadores": indicators, "total_bairros": len(bairros), "total_setores": totals["total_setores"],
                    "arquivo": f"../municipios/{uf}/{code}.json"})
    ufs = []
    for code, sigla, name, region in UFS:
        municipalities = uf_summaries.get(code, [])
        summary = aggregate_summaries([m["indicadores"] for m in municipalities]) if municipalities else None
        uf_metadata = {"cd_uf": code, "sigla_uf": sigla, "nm_uf": name,
                       "cd_regiao": region, "nm_regiao": REGIOES[region]}
        ufs.append({"metadata": uf_metadata, "resumo_uf": summary,
                    "dados_disponiveis": bool(municipalities), "arquivo": f"uf/{code}.json" if municipalities else None})
        if municipalities:
            path = output_dir / "uf" / f"{code}.json"
            write_payload(path, {"metadata": {**metadata, **uf_metadata, "nivel": "uf"},
                "resumo_uf": summary, "municipios_resumo": municipalities})
            paths.append(path)
    regions = []
    for region, name in REGIOES.items():
        summaries = [u["resumo_uf"] for u in ufs if u["metadata"]["cd_regiao"] == region and u["dados_disponiveis"]]
        regions.append({"cd_regiao": region, "nm_regiao": name,
                        "indicadores": aggregate_summaries(summaries) if summaries else None})
    path = output_dir / "brasil.json"
    write_payload(path, {"metadata": {**metadata, "nivel": "brasil"}, "ufs": ufs, "regioes": regions,
        "resumo_brasil": aggregate_summaries([u["resumo_uf"] for u in ufs if u["dados_disponiveis"]])})
    paths.append(path)
    return paths


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--setores", type=Path, required=True)
    parser.add_argument("--pib", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).resolve().parents[1] / "data/processed_real")
    parser.add_argument("--date", type=date.fromisoformat, default=datetime.now(timezone.utc).date())
    args = parser.parse_args()
    manifest = IBGEReleaseManifest.from_json(args.manifest)
    for path in ingest(args.setores, args.pib, manifest, args.output_dir, args.date.isoformat()):
        print(f"Gerado: {path}")


if __name__ == "__main__":
    main()
