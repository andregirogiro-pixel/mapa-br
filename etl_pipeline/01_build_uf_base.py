#!/usr/bin/env python3
"""Gera fixtures offline particionadas; não contém estatísticas oficiais."""

from __future__ import annotations

import argparse
from datetime import date, datetime, timezone
import json
import math
from pathlib import Path
import re


REGIOES = {
    "1": "Norte", "2": "Nordeste", "3": "Sudeste",
    "4": "Sul", "5": "Centro-Oeste",
}
# Cadastro geográfico de UFs, sem dependência de rede.
UFS = (
    ("11", "RO", "Rondônia", "1"),
    ("12", "AC", "Acre", "1"),
    ("13", "AM", "Amazonas", "1"),
    ("14", "RR", "Roraima", "1"),
    ("15", "PA", "Pará", "1"),
    ("16", "AP", "Amapá", "1"),
    ("17", "TO", "Tocantins", "1"),
    ("21", "MA", "Maranhão", "2"),
    ("22", "PI", "Piauí", "2"),
    ("23", "CE", "Ceará", "2"),
    ("24", "RN", "Rio Grande do Norte", "2"),
    ("25", "PB", "Paraíba", "2"),
    ("26", "PE", "Pernambuco", "2"),
    ("27", "AL", "Alagoas", "2"),
    ("28", "SE", "Sergipe", "2"),
    ("29", "BA", "Bahia", "2"),
    ("31", "MG", "Minas Gerais", "3"),
    ("32", "ES", "Espírito Santo", "3"),
    ("33", "RJ", "Rio de Janeiro", "3"),
    ("35", "SP", "São Paulo", "3"),
    ("41", "PR", "Paraná", "4"),
    ("42", "SC", "Santa Catarina", "4"),
    ("43", "RS", "Rio Grande do Sul", "4"),
    ("50", "MS", "Mato Grosso do Sul", "5"),
    ("51", "MT", "Mato Grosso", "5"),
    ("52", "GO", "Goiás", "5"),
    ("53", "DF", "Distrito Federal", "5"),
)
AVISO = (
    "DEMONSTRAÇÃO: todos os indicadores são simulados; não usar para análise "
    "oficial. Códigos de bairros e setores são fixtures de formato. A origem "
    "de malha é um cenário do contrato, sem geometria ou vínculo IBGE verificado."
)
CODE_LENGTHS = {
    "cd_regiao": (1,), "cd_uf": (2,), "cd_mun": (7,),
    "cd_bairro": (9, 10), "cd_setor": (15,),
}


def validate_code(value: str, field: str) -> str:
    if (not isinstance(value, str) or not re.fullmatch(r"[0-9]+", value)
            or len(value) not in CODE_LENGTHS[field]):
        raise ValueError(f"{field} deve ser string com tamanho {CODE_LENGTHS[field]}")
    return value


def nonnegative(value: float, field: str, *, integer: bool = False) -> float:
    if (isinstance(value, bool) or not isinstance(value, (int, float))
            or not math.isfinite(value) or value < 0
            or (integer and not isinstance(value, int))):
        raise ValueError(f"{field} deve ser número não negativo" +
                         (" inteiro" if integer else ""))
    return value


def aggregate_sectors(
    setores: list[dict], *, cd_mun: str, id_agregacao: str, nm_bairro: str,
) -> dict:
    """Agrega um grupo previamente delimitado; não inventa código de bairro.

    Sem microdistribuição não é possível estimar Gini. O chamador é responsável
    por validar espacialmente o vínculo entre setores e o grupo territorial.
    """
    validate_code(cd_mun, "cd_mun")
    if not setores or not isinstance(id_agregacao, str) or not id_agregacao:
        raise ValueError("Grupo precisa de setores e id_agregacao textual")
    seen = set()
    populacao = domicilios = 0
    weighted_income = []
    for setor in setores:
        code = validate_code(setor["cd_setor"], "cd_setor")
        if not code.startswith(cd_mun) or code in seen:
            raise ValueError("Setor duplicado ou fora do município")
        seen.add(code)
        population = nonnegative(setor["populacao"], "populacao", integer=True)
        weight = nonnegative(setor["domicilios"], "domicilios", integer=True)
        income = setor.get("renda_media_responsavel")
        if income is not None:
            nonnegative(income, "renda_media_responsavel")
        elif weight:
            raise ValueError("Renda ausente em setor com domicílios positivos")
        populacao += population
        domicilios += weight
        if weight:
            weighted_income.append(income * weight)
    return {
        "cd_bairro": None,
        "id_agregacao": id_agregacao,
        "nm_bairro": nm_bairro,
        "origem_malha": "setores_agregados",
        "cd_setores": sorted(seen),
        "metodo_agregacao": "media_ponderada_domicilios",
        "populacao": populacao,
        "domicilios": domicilios,
        "renda_media_responsavel": (
            round(math.fsum(weighted_income) / domicilios, 2) if domicilios else None
        ),
        "gini_estimado": None,
    }


def indicator_metadata() -> dict:
    units = {
        "populacao": "pessoas", "domicilios": "domicílios",
        "pib_total_bi": "bilhões de BRL/ano", "pib_per_capita": "BRL/pessoa/ano",
        "renda_media_domiciliar": "BRL/domicílio/mês",
        "renda_media": "BRL/domicílio/mês",
        "renda_media_responsavel": "BRL/responsável/mês",
        "gini": "índice [0,1]", "gini_estimado": "índice [0,1]",
    }
    return {
        name: {"unidade": unit, "periodo_referencia": None,
               "fonte": "fixture sintética; sem período estatístico real"}
        for name, unit in units.items()
    }


def common_metadata(updated_at: str) -> dict:
    return {
        "schema_version": "1.0", "updated_at": updated_at,
        "tipo_dados": "simulados",
        "fonte_geografica": "Cadastro de códigos e nomes de UFs/regiões IBGE",
        "indicadores": indicator_metadata(), "aviso": AVISO,
    }


def state_summary(index: int) -> dict:
    # Fórmula deliberadamente sintética; não aproxima estatísticas reais.
    population = 1_000_000 + index * 250_000
    gdp_bi = round(population * (25_000 + index * 1_000) / 1e9, 6)
    return {
        "populacao": population,
        "pib_total_bi": gdp_bi,
        "pib_per_capita": round(gdp_bi * 1e9 / population, 2),
        "renda_media_domiciliar": 2_000.0 + index * 75,
        "gini": round(0.4 + (index % 8) * 0.01, 2),
    }


def aggregate_summaries(summaries: list[dict]) -> dict:
    population = sum(s["populacao"] for s in summaries)
    gdp = math.fsum(s["pib_total_bi"] for s in summaries)
    return {
        "populacao": population, "pib_total_bi": round(gdp, 6),
        "pib_per_capita": round(gdp * 1e9 / population, 2) if population else None,
        "renda_media_domiciliar": None, "gini": None,
    }


def demo_municipality(code: str, name: str, index: int) -> dict:
    validate_code(code, "cd_mun")
    official_scenario = {
        "cd_bairro": code + "001", "nm_bairro": "Centro (demonstração)",
        "origem_malha": "ibge_bairro_oficial",
        "populacao": 1200 + index * 100, "domicilios": 400 + index * 30,
        "renda_media_responsavel": 4200.0 + index * 100, "gini_estimado": 0.46,
    }
    fallback = aggregate_sectors([
        {"cd_setor": code + "00000001", "populacao": 300,
         "domicilios": 100, "renda_media_responsavel": 2000.0},
        {"cd_setor": code + "00000002", "populacao": 600,
         "domicilios": 300, "renda_media_responsavel": 4000.0},
    ], cd_mun=code, id_agregacao=f"demo:{code}:grupo-01",
       nm_bairro="Área sem bairro oficial (demonstração)")
    return {
        "cd_mun": code, "nm_mun": name,
        "indicadores": {
            "populacao": 100_000 + index * 50_000,
            "pib_per_capita": 40_000.0 + index * 2000,
            "renda_media": 3500.0 + index * 200, "gini": 0.49,
        },
        "bairros": [official_scenario, fallback],
    }


def validate_payload(payload: dict) -> None:
    """Valida IDs em todos os níveis, inclusive setores de fallback."""
    def walk(value: object) -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                if key in CODE_LENGTHS:
                    if not (key == "cd_bairro" and child is None
                            and value.get("origem_malha") == "setores_agregados"):
                        validate_code(child, key)
                if key == "cd_setores":
                    for code in child:
                        validate_code(code, "cd_setor")
                walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)
    walk(payload)
    uf = payload.get("metadata", {}).get("cd_uf")
    for municipio in payload.get("municipios", []):
        code = municipio["cd_mun"]
        if not code.startswith(uf):
            raise ValueError("Município fora da UF")
        for bairro in municipio["bairros"]:
            codes = ([bairro["cd_bairro"]] if bairro["cd_bairro"] is not None
                     else bairro["cd_setores"])
            if any(not c.startswith(code) for c in codes):
                raise ValueError("Bairro/setor fora do município")
    json.dumps(payload, allow_nan=False)


def build(output_dir: Path, updated_at: str) -> list[Path]:
    date.fromisoformat(updated_at)
    demos = {
        "35": [("3550308", "São Paulo"), ("3509502", "Campinas")],
        "42": [("4205407", "Florianópolis"), ("4209102", "Joinville")],
    }
    ufs = []
    payloads = {}
    for index, (code, sigla, name, region) in enumerate(UFS):
        metadata = {
            **common_metadata(updated_at), "cd_uf": code, "sigla_uf": sigla,
            "nm_uf": name, "cd_regiao": region, "nm_regiao": REGIOES[region],
        }
        summary = state_summary(index)
        # O índice mantém metadados comuns uma única vez para reduzir a carga.
        ufs.append({
            "metadata": {key: metadata[key] for key in (
                "cd_uf", "sigla_uf", "nm_uf", "cd_regiao", "nm_regiao", "updated_at",
            )},
            "resumo_uf": summary, "dados_disponiveis": code in demos,
            "arquivo": f"uf/{code}.json" if code in demos else None,
        })
        if code in demos:
            payloads[f"uf/{code}.json"] = {
                "metadata": {**metadata,
                             "cobertura_municipios": "amostra_simulada",
                             "cobertura_bairros": "amostra_simulada"},
                "resumo_uf": summary,
                "municipios": [demo_municipality(c, n, i)
                               for i, (c, n) in enumerate(demos[code])],
            }
    payloads["brasil.json"] = {
        "metadata": common_metadata(updated_at),
        "resumo_brasil": aggregate_summaries([u["resumo_uf"] for u in ufs]),
        "regioes": [
            {"cd_regiao": code, "nm_regiao": name,
             "indicadores": aggregate_summaries([
                 u["resumo_uf"] for u in ufs if u["metadata"]["cd_regiao"] == code
             ])} for code, name in REGIOES.items()
        ],
        "ufs": ufs,
    }
    # Validar todo o lote antes de gravar qualquer arquivo.
    for payload in payloads.values():
        validate_payload(payload)
    paths = []
    for relative, payload in payloads.items():
        path = output_dir / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2,
                                   allow_nan=False) + "\n", encoding="utf-8")
        paths.append(path)
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
