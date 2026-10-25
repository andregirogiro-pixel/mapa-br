#!/usr/bin/env python3
"""Gera fixtures offline particionadas; não contém estatísticas oficiais."""

from __future__ import annotations

import argparse
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_EVEN
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
CODE_PATTERNS = {
    field: re.compile(r"[0-9]{" + ("9,10" if field == "cd_bairro" else str(lengths[0])) + "}")
    for field, lengths in CODE_LENGTHS.items()
}
# Perfil aceito pelo contrato demonstrativo, não uma especificação verificada
# de toda malha IBGE. O adaptador real deve fixar release, dicionário e perfil.
CODE_PATTERNS["cd_setor"] = re.compile(r"[0-9]{15}[A-Z]?")


def normalize_code(value: str, field: str) -> str:
    """Normaliza apenas bordas e caixa; nunca converte números nem corta sufixos."""
    if not isinstance(value, str):
        raise ValueError(f"{field} deve chegar da origem como string")
    normalized = value.strip()
    if field == "cd_setor":
        normalized = normalized.upper()
    return validate_code(normalized, field)


def validate_code(value: str, field: str) -> str:
    if not isinstance(value, str) or not CODE_PATTERNS[field].fullmatch(value):
        raise ValueError(f"{field} inválido para o perfil {CODE_PATTERNS[field].pattern}")
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
    cd_bairro: str | None = None,
) -> dict:
    """Agrega setores normalizados de um mesmo período e universo de renda.

    `domicilios` é o total físico; `responsaveis_renda` é o denominador exato
    da variável escolhida (inclusive/exclusive sem rendimento conforme fonte).
    Nunca deduzir esse peso do total físico. Massa e média devem ter o mesmo
    universo. O adaptador distingue sigilo de outras ausências; None não basta.
    """
    validate_code(cd_mun, "cd_mun")
    if cd_bairro is not None:
        validate_code(cd_bairro, "cd_bairro")
        if not cd_bairro.startswith(cd_mun):
            raise ValueError("cd_bairro incompatível com cd_mun")
    if not setores or not isinstance(id_agregacao, str) or not id_agregacao:
        raise ValueError("Grupo precisa de setores e id_agregacao textual")
    seen = set()
    populacao = domicilios = responsaveis = peso_valido = 0
    sob_sigilo = sem_renda = por_massa = por_media = 0
    # Decimal evita erro binário ao somar massas monetárias. Uma soma corrente
    # dispensa a lista O(n) de produtos; os IDs ainda exigem memória O(n).
    income_sum = Decimal(0)
    for setor in setores:
        code = validate_code(setor["cd_setor"], "cd_setor")
        if not code.startswith(cd_mun) or code in seen:
            raise ValueError("Setor duplicado ou fora do município")
        seen.add(code)
        population = nonnegative(setor["populacao"], "populacao", integer=True)
        households = nonnegative(setor["domicilios"], "domicilios", integer=True)
        weight = nonnegative(setor["responsaveis_renda"], "responsaveis_renda", integer=True)
        income = setor.get("renda_media_responsavel")
        mass = setor.get("massa_rendimento_setor")
        status = setor.get("status_renda", "ausente" if income is None and mass is None
                           else "divulgada")
        if status not in {"divulgada", "sigilo", "ausente"}:
            raise ValueError("status_renda inválido")
        if income is not None:
            nonnegative(income, "renda_media_responsavel")
        if mass is not None:
            nonnegative(mass, "massa_rendimento_setor")
        available = mass is not None or income is not None
        if (status == "divulgada") != available:
            raise ValueError("status_renda incompatível com massa/média divulgada")
        if weight == 0 and ((income is not None and income > 0)
                            or (mass is not None and mass > 0)):
            raise ValueError("Renda ou massa positiva com universo de renda zero")
        if available and weight:
            if mass is not None:
                income_sum += Decimal(str(mass))
                por_massa += 1
            else:
                income_sum += Decimal(str(income)) * weight
                por_media += 1
            peso_valido += weight
        elif not available and weight:
            sem_renda += 1
            sob_sigilo += status == "sigilo"
        populacao += population
        domicilios += households
        responsaveis += weight
    method = ("massa_e_media_ponderada_responsaveis_validos" if por_massa and por_media
              else "massa_por_responsaveis_validos" if por_massa
              else "media_ponderada_responsaveis_validos" if por_media
              else "sem_renda_divulgada")
    return {
        "cd_bairro": cd_bairro,
        "id_agregacao": id_agregacao,
        "nm_bairro": nm_bairro,
        "origem_malha": "ibge_bairro_oficial" if cd_bairro else "setores_agregados",
        "cd_setores": sorted(seen),
        "metodo_agregacao": method,
        "populacao": populacao,
        "domicilios": domicilios,
        "responsaveis_renda": responsaveis,
        "responsaveis_com_renda": peso_valido,
        "setores_sem_renda": sem_renda,
        "setores_sob_sigilo": sob_sigilo,
        "setores_por_massa": por_massa,
        "setores_por_media": por_media,
        "cobertura_renda_proporcao": round(peso_valido / responsaveis, 4) if responsaveis else None,
        "renda_media_responsavel": (
            float((income_sum / peso_valido).quantize(Decimal("0.01"), rounding=ROUND_HALF_EVEN))
            if peso_valido else None
        ),
        "gini_estimado": None,
    }


def indicator_metadata() -> dict:
    units = {
        "populacao": "pessoas", "domicilios": "domicílios",
        "pib_mil_reais": "mil BRL/ano, preços correntes",
        "pib_total_bi": "bilhões de BRL/ano (derivado)", "pib_per_capita": "BRL/pessoa/ano",
        "responsaveis_renda": "pessoas no universo da variável de renda",
        "responsaveis_com_renda": "pessoas em setores com massa ou média divulgada",
        "cobertura_renda_proporcao": "proporção [0,1] do universo de renda coberto",
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
        "schema_version": "1.1", "updated_at": updated_at,
        "tipo_dados": "simulados",
        "fonte_geografica": "Cadastro de códigos e nomes de UFs/regiões IBGE",
        "indicadores": indicator_metadata(), "aviso": AVISO,
        "perfil_codigo_setor": "15_digitos_sufixo_maiusculo_opcional",
        "release_censo": None,
        "universo_renda": "fixture: responsáveis DPPO, inclusive sem rendimento",
        "mapeamento_variaveis_censo": None,
    }


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
        "gini": round(0.4 + (index % 8) * 0.01, 2),
    }


def aggregate_summaries(summaries: list[dict]) -> dict:
    # Contrato das fixtures: PIB inteiro em mil reais. O adaptador de uma fonte
    # com frações deve preservar sua escala exata, nunca truncar para int.
    for summary in summaries:
        nonnegative(summary["pib_mil_reais"], "pib_mil_reais", integer=True)
        nonnegative(summary["populacao"], "populacao", integer=True)
    population = sum(s["populacao"] for s in summaries)
    gdp = sum(s["pib_mil_reais"] for s in summaries)
    return {
        "populacao": population, "pib_mil_reais": gdp, "pib_total_bi": gdp / 1_000_000,
        "pib_per_capita": round(gdp * 1000 / population, 2) if population else None,
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
            codes = ([bairro["cd_bairro"]] if bairro["cd_bairro"] is not None else [])
            codes += bairro.get("cd_setores", [])
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
