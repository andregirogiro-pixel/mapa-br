#!/usr/bin/env python3
"""Gera fixtures offline particionadas; não contém estatísticas oficiais."""

from __future__ import annotations

import argparse
from datetime import date, datetime, timezone
import json
from pathlib import Path

import sys

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from etl_pipeline.core_contract import (
    normalize_code, validate_code, nonnegative, aggregate_sectors,
    aggregate_summaries, validate_payload, write_payload,
)

from etl_pipeline.reference_data import UFS, REGIOES, common_metadata


def state_summary(index: int) -> dict:
    # Fórmula deliberadamente sintética; não aproxima estatísticas reais.
    population = 1_000_000 + index * 250_000
    # Unidade canônica inteira em mil reais nas fixtures, sem round intermediário.
    gdp_mil = population * (25_000 + index * 1_000) // 1000
    return {
        "populacao": population,
        "pib_mil_reais": gdp_mil,
        "pib_total_bi": gdp_mil / 1_000_000,
        "pib_per_capita": round(gdp_mil * 1000 / population, 2),
        "renda_media_domiciliar": 2_000.0 + index * 75,
        "renda_media_responsavel": None,
        "gini": round(0.4 + (index % 8) * 0.01, 2),
    }


def demo_municipality(code: str, name: str, index: int) -> dict:
    code = normalize_code(code, "cd_mun")
    official_scenario = aggregate_sectors([
        {"cd_setor": code + "00000004", "populacao": 1200 + index * 100,
         "domicilios": 400 + index * 30, "responsaveis_renda": 350 + index * 20,
         "renda_media_responsavel": 4200.0 + index * 100},
        {"cd_setor": code + "00000005", "populacao": 6,
         "domicilios": 3, "responsaveis_renda": 2,
         "renda_media_responsavel": None, "status_renda": "sigilo"},
    ], cd_mun=code, cd_bairro=code + "001", id_agregacao=code + "001",
       nm_bairro="Centro (demonstração)")
    fallback = aggregate_sectors([
        {"cd_setor": code + "00000001", "populacao": 300,
         "domicilios": 160, "responsaveis_renda": 100,
         "renda_media_responsavel": 2000.0, "massa_rendimento_setor": 200000},
        {"cd_setor": code + "00000002A", "populacao": 600,
         "domicilios": 450, "responsaveis_renda": 300,
         "renda_media_responsavel": 4000.0},
        {"cd_setor": code + "00000003", "populacao": 12,
         "domicilios": 8, "responsaveis_renda": 4,
         "renda_media_responsavel": None, "status_renda": "sigilo"},
    ], cd_mun=code, id_agregacao=f"demo:{code}:grupo-01",
       nm_bairro="Área sem bairro oficial (demonstração)")
    population = 100_000 + index * 50_000
    gdp = population * (40_000 + index * 2000) // 1000
    return {
        "cd_mun": code, "nm_mun": name,
        "indicadores": {
            "populacao": population,
            "pib_mil_reais": gdp, "pib_total_bi": gdp / 1_000_000,
            "pib_per_capita": round(gdp * 1000 / population, 2),
            "renda_media_domiciliar": 3500.0 + index * 200,
            "renda_media_responsavel": None, "gini": 0.49,
        },
        "bairros": [official_scenario, fallback],
    }


def build(output_dir: Path, updated_at: str) -> list[Path]:
    date.fromisoformat(updated_at)
    demos = {
        "35": [("3550308", "São Paulo"), ("3509502", "Campinas")],
        "42": [("4205407", "Florianópolis"), ("4209102", "Joinville")],
    }
    ufs, paths = [], []
    for index, (code, sigla, name, region) in enumerate(UFS):
        code = normalize_code(code, "cd_uf")
        region = normalize_code(region, "cd_regiao")
        metadata = {
            **common_metadata(updated_at), "nivel": "uf", "cd_uf": code,
            "sigla_uf": sigla, "nm_uf": name, "cd_regiao": region,
            "nm_regiao": REGIOES[region],
        }
        summary = state_summary(index)
        ufs.append({
            "metadata": {key: metadata[key] for key in (
                "cd_uf", "sigla_uf", "nm_uf", "cd_regiao", "nm_regiao", "updated_at",
            )},
            "resumo_uf": summary, "dados_disponiveis": code in demos,
            "arquivo": f"uf/{code}.json" if code in demos else None,
        })
        if code not in demos:
            continue
        municipality_summaries = []
        for i, (municipality_code, municipality_name) in enumerate(demos[code]):
            municipality = demo_municipality(municipality_code, municipality_name, i)
            municipality_code = municipality["cd_mun"]
            detail_path = output_dir / "municipios" / code / f"{municipality_code}.json"
            write_payload(detail_path, {
                "metadata": {**metadata, "nivel": "municipio", "cd_mun": municipality_code,
                             "cobertura_bairros": "amostra_simulada"},
                "municipio": municipality,
            })
            paths.append(detail_path)
            municipality_summaries.append({
                "cd_mun": municipality_code, "nm_mun": municipality_name,
                "indicadores": municipality["indicadores"],
                "total_bairros": len(municipality["bairros"]),
                "total_setores": sum(b["total_setores"] for b in municipality["bairros"]),
                # Caminho relativo ao próprio arquivo da UF, não ao índice nacional.
                "arquivo": f"../municipios/{code}/{municipality_code}.json",
            })
        uf_path = output_dir / "uf" / f"{code}.json"
        write_payload(uf_path, {
            "metadata": {**metadata, "cobertura_municipios": "amostra_simulada"},
            "resumo_uf": summary, "municipios_resumo": municipality_summaries,
        })
        paths.append(uf_path)
    index_path = output_dir / "brasil.json"
    write_payload(index_path, {
        "metadata": {**common_metadata(updated_at), "nivel": "brasil"},
        "resumo_brasil": aggregate_summaries([u["resumo_uf"] for u in ufs]),
        "regioes": [
            {"cd_regiao": code, "nm_regiao": name,
             "indicadores": aggregate_summaries([
                 u["resumo_uf"] for u in ufs if u["metadata"]["cd_regiao"] == code
             ])} for code, name in REGIOES.items()
        ], "ufs": ufs,
    })
    paths.append(index_path)
    return paths


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path,
                        default=Path(__file__).resolve().parents[1] / "data/processed")
    parser.add_argument("--date", type=date.fromisoformat,
                        default=datetime.now(timezone.utc).date())
    args = parser.parse_args()
    for path in build(args.output_dir, args.date.isoformat()):
        print(f"Gerado (SIMULADO): {path}")


if __name__ == "__main__":
    main()
