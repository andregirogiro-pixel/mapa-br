#!/usr/bin/env python3
"""Audita fontes oficiais de SC sem executar ingestão ou imputar renda.

Uso: python3 etl_pipeline/audits/verify_2022_sc.py
Reutiliza download/cache/TLS do 03 e validação numérica do 02. Os dicionários
são baixados para inspeção; sua interpretação semântica não é automatizada.
Lê somente o recorte SC em memória. Sucesso significa auditoria concluída,
não aprovação para publicar: o relatório mantém status blocked.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import csv
from datetime import datetime, timezone
from decimal import Decimal, localcontext
import importlib
import io
import json
from pathlib import Path
import sys
import zipfile


ROOT_URL = (
    "https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/"
    "Agregados_por_Setores_Censitarios_Rendimento_do_Responsavel/"
)
GENERAL_URL = "https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/Agregados_por_Setores_Censitarios/"
SOURCES = {
    "setores": ROOT_URL + "Agregados_por_setores_renda_responsavel_BR_20260508_csv.zip",
    "municipios": ROOT_URL + "Agregados_por_municipios_renda_responsavel_BR_20260508_csv.zip",
    "dicionario_renda": ROOT_URL + "dicionario_de_dados_renda_responsavel_20260508.xlsx",
    "basico": GENERAL_URL + "Agregados_por_Setor_csv/Agregados_por_setores_basico_BR_20260520.zip",
    "dicionario_basico": GENERAL_URL + "dicionario_de_dados_agregados_por_setores_censitarios_20260520.xlsx",
}


def source_rows(path: Path, *, encoding: str):
    with zipfile.ZipFile(path) as package:
        members = [i for i in package.infolist() if i.filename.lower().endswith(".csv")]
        if len(members) != 1:
            raise ValueError("Audit requires exactly one CSV per ZIP")
        with package.open(members[0]) as binary:
            with io.TextIOWrapper(binary, encoding=encoding, errors="strict", newline="") as text:
                reader = csv.DictReader(text, delimiter=";", strict=True)
                if not reader.fieldnames or len(reader.fieldnames) != len(set(reader.fieldnames)):
                    raise ValueError("Cabeçalho CSV ausente ou duplicado")
                for row in reader:
                    if None in row or any(v is None for v in row.values()):
                        raise ValueError("Linha CSV irregular")
                    yield row


def published_number(raw: str, *, helper, field: str, decimal_sep: str = ".", as_integer: bool = False) -> Decimal:
    value, status = helper.adapter.parse_ibge_numeric(
        raw, field=field, decimal_sep=decimal_sep, as_integer=as_integer,
    )
    if status != "divulgada":
        raise ValueError(f"Valor não divulgado em comparação elegível: {field}")
    return Decimal(value)


def verify_inventory(archive: Path, sectors_by_mun: dict, *, helper, cache: Path, output: Path) -> tuple[dict, list[dict]]:
    """Confere inventários publicados; não preenche dados ausentes do join."""
    basic = {}
    for row in source_rows(archive, encoding="cp1252"):
        code = helper.normalize_code(row["CD_SETOR"], "cd_setor")
        if not code.startswith("42"):
            continue
        municipality = helper.normalize_code(row["CD_MUN"], "cd_mun")
        if municipality != code[:7] or code in basic:
            raise ValueError(f"Setor duplicado ou incompatível com município: {code}")
        for field in ("v0001", "v0002"):
            value, status = helper.adapter.parse_ibge_numeric(
                row[field], field=field, decimal_sep=",", as_integer=True,
            )
            if status != "divulgada":
                raise ValueError(f"Demografia não divulgada: {code}/{field}")
            row[field] = value
        basic[code] = row
    if not basic:
        raise ValueError("Inventário básico de SC vazio")
    income_codes = {r["CD_SETOR"] for rows in sectors_by_mun.values() for r in rows}
    missing = sorted(basic.keys() - income_codes)
    extra = sorted(income_codes - basic.keys())
    situation_9 = [r for r in basic.values() if r["CD_SIT"] == "9"]
    municipalities = {r["CD_MUN"] for r in basic.values()}
    gdp, gdp_receipts, filtered = helper.fetch_pib_sidra_for_ufs(["42"], "2021", cache, municipalities)
    with (output / "pib_sc_2021.csv").open("w", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream, delimiter=";")
        writer.writerow(["CD_MUN", "PIB_MIL_REAIS"])
        writer.writerows(sorted(gdp.items()))
    with (output / "setores_sem_linha_renda.csv").open("w", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream, delimiter=";")
        writer.writerow(["CD_SETOR", "CD_MUN", "POPULACAO", "DOMICILIOS", "CD_SIT"])
        writer.writerows([code, basic[code]["CD_MUN"], basic[code]["v0001"], basic[code]["v0002"], basic[code]["CD_SIT"]] for code in missing)
    return {
        "municipios": len(municipalities), "setores_basico": len(basic),
        "setores_renda": len(income_codes),
        "populacao_basico": sum(r["v0001"] for r in basic.values()),
        "domicilios_fisicos_basico": sum(r["v0002"] for r in basic.values()),
        "setores_basico_sem_renda": len(missing), "setores_renda_sem_basico": len(extra),
        "setores_sem_linha_renda_com_populacao_positiva": sum(basic[c]["v0001"] > 0 for c in missing),
        "populacao_em_setores_sem_linha_renda": sum(basic[c]["v0001"] for c in missing),
        "domicilios_em_setores_sem_linha_renda": sum(basic[c]["v0002"] for c in missing),
        "setores_situacao_9": len(situation_9),
        "populacao_situacao_9": sum(r["v0001"] for r in situation_9),
        "domicilios_situacao_9": sum(r["v0002"] for r in situation_9),
        "setores_cd_bairro_ponto": sum(r["CD_BAIRRO"] == "." for r in basic.values()),
        "pib_ano": "2021", "pib_municipios": len(gdp), "pib_extras_filtrados": filtered,
        "pib_municipios_faltantes": sorted(municipalities - gdp.keys()),
        "inventario_limite": "Comparação dos CSVs publicados; completude frente à malha não verificada",
    }, gdp_receipts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--output-dir", type=Path)
    args = parser.parse_args()
    repo = args.repo.resolve()
    sys.path.insert(0, str(repo))
    helper = importlib.import_module("etl_pipeline.03_fetch_ibge_raw")
    output = args.output_dir or repo / "data/raw/verification_2022"
    output.mkdir(parents=True, exist_ok=True)
    artifacts, receipts = {}, {}
    for kind, url in SOURCES.items():
        path, receipt = helper.download(url, repo / "data/raw/cache")
        artifacts[kind] = path
        receipts[kind] = receipt

    sectors_by_mun = defaultdict(list)
    sector_count = 0
    suppressed_count = 0
    seen_sectors = set()
    for row in source_rows(artifacts["setores"], encoding="utf-8-sig"):
        code = helper.normalize_code(row["CD_SETOR"], "cd_setor")
        if not code.startswith("42"):
            continue
        sector_count += 1
        if code in seen_sectors:
            raise ValueError(f"Setor de renda duplicado: {code}")
        seen_sectors.add(code)
        row["CD_SETOR"] = code
        sectors_by_mun[code[:7]].append(row)
        all_suppressed = all(row[f"V0600{i}"] == "X" for i in range(1, 7))
        suppressed_count += int(all_suppressed)

    inventory, gdp_receipts = verify_inventory(
        artifacts["basico"], sectors_by_mun, helper=helper,
        cache=repo / "data/raw/cache", output=output,
    )
    receipts["pib_sc_2021"] = gdp_receipts[0]

    comparisons = []
    skip_counts = Counter()
    seen_municipalities = set()
    for municipality in source_rows(artifacts["municipios"], encoding="cp1252"):
        code = helper.normalize_code(municipality["CD_MUN"], "cd_mun")
        if not code.startswith("42"):
            continue
        if code in seen_municipalities:
            raise ValueError(f"Município de renda duplicado: {code}")
        seen_municipalities.add(code)
        sectors = sectors_by_mun.get(code, [])
        if not sectors:
            skip_counts["no_sector_rows"] += 1
            continue
        if any(s["V06001"] in {"X", ""} or s["V06004"] in {"X", ""} for s in sectors):
            skip_counts["sector_count_or_mean_suppressed_or_absent"] += 1
            continue
        weight = sum((published_number(s["V06001"], helper=helper, field="V06001", as_integer=True)
                      for s in sectors), Decimal(0))
        municipal_weight = published_number(municipality["V06001"], helper=helper, field="V06001",
                                            decimal_sep=",", as_integer=True)
        if weight != municipal_weight:
            skip_counts["sector_V06001_sum_differs_from_municipal_V06001"] += 1
            continue
        if weight == 0:
            skip_counts["zero_total_weight"] += 1
            continue
        numerator = sum(
            (published_number(s["V06004"], helper=helper, field="V06004") *
             published_number(s["V06001"], helper=helper, field="V06001", as_integer=True) for s in sectors),
            Decimal(0),
        )
        with localcontext() as context:
            context.prec = 28
            proposed_mean = numerator / weight
        published_mean = published_number(municipality["V06004"], helper=helper, field="V06004", decimal_sep=",")
        comparisons.append({
            "cd_mun": code,
            "nm_mun": municipality["NM_MUN"],
            "sector_rows": len(sectors),
            "sector_rows_with_V06001_and_V06004_known": len(sectors),
            "sector_rows_with_V06001_or_V06004_X": 0,
            "sum_sector_V06001": str(weight),
            "published_municipal_V06001": str(municipal_weight),
            "sum_sector_V06004_times_V06001": str(numerator),
            "mean_weighted_by_V06001": str(proposed_mean),
            "published_municipal_V06004": str(published_mean),
            "difference_weighted_minus_published": str(proposed_mean - published_mean),
        })

    comparisons.sort(key=lambda x: x["cd_mun"])
    if set(sectors_by_mun) != seen_municipalities:
        raise ValueError("Conjuntos municipais da renda setorial/municipal diferem")
    if not comparisons:
        raise ValueError("Nenhum município elegível para a comparação")
    maximum = max(comparisons, key=lambda x: abs(Decimal(x["difference_weighted_minus_published"])))
    examples = [x for x in comparisons if x["cd_mun"] in {"4209854", "4212700"}]
    if len(examples) != 2:
        raise ValueError("Expected audit examples did not satisfy eligibility conditions")
    report = {
        "kind": "source_audit_not_ingestion_profile",
        "status": "blocked",
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "census_period": "2022",
        "income_release_file_date": "20260508",
        "cd_uf": "42",
        "sources": receipts,
        "inventory": inventory,
        "blockers": [
            "V06004 refere-se a responsáveis COM rendimentos; seu denominador exato não foi identificado",
            "Ponderar V06004 por V06001 diverge do agregado municipal oficial",
            "Inventários básico/renda diferem; não inferir zero ou X em linhas ausentes",
            "Bairro ausente '.' e situação 9 exigem adaptação explícita da release",
        ],
        "dictionary_definitions": {
            "V06001": "Pessoas responsáveis em domicílios particulares permanentes ocupados",
            "V06004": "Valor do rendimento nominal médio mensal das pessoas responsáveis com rendimentos por domicílios particulares permanentes ocupados",
        },
        "method": {
            "eligibility": "All published sector rows for municipality have disclosed V06001 and V06004; sum of sector V06001 exactly equals published municipal V06001; total weight is positive.",
            "formula": "sum(Decimal(sector.V06004) * Decimal(sector.V06001)) / sum(Decimal(sector.V06001))",
            "comparison": "Calculated weighted mean minus published municipal V06004.",
            "arithmetic": "Exact Decimal numerator and integer denominator; division uses Python Decimal default precision 28; no intermediate monetary quantization.",
            "interpretation": "Observed discrepancies disallow assuming that V06001 reproduces the weighting universe of V06004. This comparison alone does not establish causality or the exact correct denominator.",
            "inventory_limit": "Eligibility covers the published income CSV rows, not a separate verification of completeness against the basic or geographic sector inventory.",
        },
        "summary": {
            "sc_sector_income_rows": sector_count,
            "sc_municipalities_with_sector_rows": len(sectors_by_mun),
            "sc_sector_rows_all_six_income_variables_X": suppressed_count,
            "sc_sector_rows_not_all_six_X": sector_count - suppressed_count,
            "eligible_municipalities": len(comparisons),
            "excluded_municipalities_by_reason": dict(skip_counts),
            "eligible_with_absolute_difference_over_0_01": sum(abs(Decimal(x["difference_weighted_minus_published"])) > Decimal("0.01") for x in comparisons),
            "eligible_with_absolute_difference_over_0_05": sum(abs(Decimal(x["difference_weighted_minus_published"])) > Decimal("0.05") for x in comparisons),
            "maximum_absolute_difference": str(abs(Decimal(maximum["difference_weighted_minus_published"]))),
            "maximum_difference_cd_mun": maximum["cd_mun"],
        },
        "examples": examples,
        "all_comparisons_file": "renda_comparisons_sc.json",
        "not_an_ingestion_output": True,
    }
    helper.atomic_json(output / "renda_comparisons_sc.json", comparisons)
    helper.atomic_json(output / "verification_renda_2022.json", report)
    helper.atomic_json(output / "audit_report.json", report)
    print(json.dumps({"output": str(output), "status": report["status"], "inventory": inventory,
                      "summary": report["summary"], "examples": examples}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
