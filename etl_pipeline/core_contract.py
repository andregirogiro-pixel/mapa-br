"""Motor único de normalização, validação, agregação e escrita do contrato."""
from decimal import Decimal, ROUND_HALF_EVEN
import json
import math
from pathlib import Path
import re
import tempfile


CODE_LENGTHS = {
    "cd_regiao": (1,), "cd_uf": (2,), "cd_mun": (7,),
    "cd_dist": (9,), "cd_subdist": (11,),
    "cd_bairro": (9, 10), "cd_setor": (15,),
}
CODE_PATTERNS = {
    field: re.compile(r"[0-9]{" + ("9,10" if field == "cd_bairro" else str(lengths[0])) + "}")
    for field, lengths in CODE_LENGTHS.items()
}
# Perfil aceito pelo contrato demonstrativo, não uma especificação verificada
# de toda malha IBGE. O adaptador real deve fixar release, dicionário e perfil.
CODE_PATTERNS["cd_setor"] = re.compile(r"[0-9]{15}[A-Z]?")
MEAN_TOLERANCE = Decimal("0.05")
WATER_BODY_DENYLIST = frozenset({"4300001", "4300002"})


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


def nonnegative(value: int | float | Decimal, field: str, *, integer: bool = False) -> int | float | Decimal:
    if (isinstance(value, bool) or not isinstance(value, (int, float, Decimal))
            or not (value.is_finite() if isinstance(value, Decimal) else math.isfinite(value)) or value < 0
            or (integer and not isinstance(value, int))):
        raise ValueError(f"{field} deve ser número não negativo" +
                         (" inteiro" if integer else ""))
    return value


def validate_sector_invariants(setor: dict) -> None:
    """Valida uma linha já normalizada sem construir um agregado descartável."""
    code = setor.get("cd_setor", "<sem código>")
    population = nonnegative(setor["populacao"], "populacao", integer=True)
    households = nonnegative(setor["domicilios"], "domicilios", integer=True)
    weight = nonnegative(setor["responsaveis_renda"], "responsaveis_renda", integer=True)
    if weight > population or weight > households:
        raise ValueError(f"Setor {code}: responsáveis excedem população ou domicílios")
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
    if mass is not None and income is not None and weight > 0:
        # Comparação sem divisão: equivalente a |massa/peso - média| > 0.05,
        # evita arredondar um quociente periódico no limite da tolerância.
        difference = abs(Decimal(str(mass)) - Decimal(str(income)) * weight)
        if difference > MEAN_TOLERANCE * weight:
            raise ValueError(f"Setor {code}: massa e média incompatíveis para o peso informado")
    available = mass is not None or income is not None
    unknown_weight = setor.get("universo_renda_suprimido", False)
    if not isinstance(unknown_weight, bool):
        raise ValueError("universo_renda_suprimido deve ser booleano")
    if unknown_weight and (weight != 0 or status != "sigilo" or available):
        raise ValueError("Universo suprimido exige peso zero e renda/massa sob sigilo")
    if (status == "divulgada") != available:
        raise ValueError("status_renda incompatível com massa/média divulgada")
    if weight == 0 and ((income is not None and income > 0)
                        or (mass is not None and mass > 0)):
        raise ValueError("Renda ou massa positiva com universo de renda zero")


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
    cd_mun = normalize_code(cd_mun, "cd_mun")
    if cd_bairro is not None:
        cd_bairro = normalize_code(cd_bairro, "cd_bairro")
        if not cd_bairro.startswith(cd_mun):
            raise ValueError("cd_bairro incompatível com cd_mun")
    if not setores or not isinstance(id_agregacao, str) or not id_agregacao:
        raise ValueError("Grupo precisa de setores e id_agregacao textual")
    seen = set()
    populacao = domicilios = responsaveis = peso_valido = 0
    sob_sigilo = sem_renda = por_massa = por_media = 0
    universo_suprimido = 0
    # Decimal evita erro binário ao somar massas monetárias. Uma soma corrente
    # dispensa a lista O(n) de produtos; os IDs ainda exigem memória O(n).
    income_sum = Decimal(0)
    for setor in setores:
        code = normalize_code(setor["cd_setor"], "cd_setor")
        if not code.startswith(cd_mun) or code in seen:
            raise ValueError("Setor duplicado ou fora do município")
        seen.add(code)
        validate_sector_invariants(setor)
        population, households, weight = (setor[k] for k in
            ("populacao", "domicilios", "responsaveis_renda"))
        income, mass = setor.get("renda_media_responsavel"), setor.get("massa_rendimento_setor")
        available = income is not None or mass is not None
        status = setor.get("status_renda", "divulgada" if available else "ausente")
        unknown_weight = setor.get("universo_renda_suprimido", False)
        universo_suprimido += unknown_weight
        if available and weight:
            if mass is not None:
                income_sum += Decimal(str(mass))
                por_massa += 1
            else:
                income_sum += Decimal(str(income)) * weight
                por_media += 1
            peso_valido += weight
        elif not available and (weight or unknown_weight):
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
        "id_agregacao": f"bairro:{cd_bairro}" if cd_bairro else id_agregacao,
        "nm_bairro": nm_bairro,
        "origem_malha": "ibge_bairro_oficial" if cd_bairro else "setores_agregados",
        "cd_setores": sorted(seen),
        "total_setores": len(seen),
        "metodo_agregacao": method,
        "populacao": populacao,
        "pib_mil_reais": None,
        "pib_mil_reais_exato": None,
        "pib_total_bi": None,
        "pib_per_capita": None,
        "renda_media_domiciliar": None,
        "gini": None,
        "domicilios": domicilios,
        "responsaveis_renda": responsaveis,
        "responsaveis_com_renda": peso_valido,
        "setores_sem_renda": sem_renda,
        "setores_sob_sigilo": sob_sigilo,
        "setores_por_massa": por_massa,
        "setores_por_media": por_media,
        "setores_universo_renda_suprimido": universo_suprimido,
        "massa_rendimento_considerada": format(income_sum, "f"),
        "cobertura_renda_proporcao": (round(peso_valido / responsaveis, 4)
                                     if responsaveis and not universo_suprimido else None),
        "renda_media_responsavel": (
            float((income_sum / peso_valido).quantize(Decimal("0.01"), rounding=ROUND_HALF_EVEN))
            if peso_valido else None
        ),
        "gini_estimado": None,
    }



COUNT_KEYS = frozenset({
    "domicilios", "responsaveis_renda", "responsaveis_com_renda", "setores_sem_renda",
    "setores_sob_sigilo", "setores_por_massa", "setores_por_media",
    "setores_universo_renda_suprimido", "total_setores",
})
INDICATOR_KEYS = COUNT_KEYS | {
    "populacao", "pib_mil_reais", "pib_mil_reais_exato", "pib_total_bi", "pib_per_capita",
    "renda_media_domiciliar", "renda_media_responsavel", "gini",
    "massa_rendimento_considerada", "cobertura_renda_proporcao",
}


def gdp_fields(gdp: int | Decimal, population: int) -> dict:
    nonnegative(gdp, "pib_mil_reais")
    nonnegative(population, "populacao", integer=True)
    gdp = Decimal(str(gdp))
    return {
        "pib_mil_reais": int(gdp) if gdp == gdp.to_integral_value() else float(gdp),
        "pib_mil_reais_exato": format(gdp, "f"),
        "pib_total_bi": float(gdp / 1_000_000),
        "pib_per_capita": float((gdp * 1000 / population).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_EVEN)) if population else None,
    }


def indicators_from_totals(totals: dict, gdp: int | Decimal) -> dict:
    """Projeção única dos totais censitários + PIB, usada por fixtures e ingestão."""
    result = {key: totals[key] for key in sorted(INDICATOR_KEYS) if key not in {
        "pib_mil_reais", "pib_mil_reais_exato", "pib_total_bi", "pib_per_capita"}}
    result.update(gdp_fields(gdp, totals["populacao"]))
    return result


def validate_indicators(value: dict) -> None:
    if not isinstance(value, dict) or set(value) != INDICATOR_KEYS:
        raise ValueError("Indicadores devem obedecer ao schema canônico de chaves")
    nonnegative(value["populacao"], "populacao", integer=True)
    for key in COUNT_KEYS:
        if value[key] is not None:
            nonnegative(value[key], key, integer=True)
    for key in ("pib_mil_reais_exato", "massa_rendimento_considerada"):
        if value[key] is not None:
            if not isinstance(value[key], str) or not re.fullmatch(r"[0-9]+(?:\.[0-9]+)?", value[key]):
                raise ValueError(f"{key} deve ser texto decimal exato não negativo")
    for key in ("pib_mil_reais", "pib_total_bi", "pib_per_capita", "renda_media_domiciliar",
                "renda_media_responsavel", "gini", "cobertura_renda_proporcao"):
        if value[key] is not None:
            nonnegative(value[key], key)
    for key in ("gini", "cobertura_renda_proporcao"):
        if value[key] is not None and value[key] > 1:
            raise ValueError(f"{key} deve estar entre 0 e 1")


def aggregate_summaries(summaries: list[dict]) -> dict:
    # Contrato das fixtures: PIB inteiro em mil reais. O adaptador de uma fonte
    # com frações deve preservar sua escala exata, nunca truncar para int.
    for summary in summaries:
        if "pib_mil_reais_exato" in summary:
            nonnegative(Decimal(summary["pib_mil_reais_exato"]), "pib_mil_reais_exato")
        else:
            nonnegative(summary["pib_mil_reais"], "pib_mil_reais", integer=True)
        nonnegative(summary["populacao"], "populacao", integer=True)
    population = sum(s["populacao"] for s in summaries)
    gdp = sum((Decimal(s.get("pib_mil_reais_exato", str(s["pib_mil_reais"])))
               for s in summaries), Decimal(0))
    result = {key: None for key in sorted(INDICATOR_KEYS)}
    result.update(populacao=population, **gdp_fields(gdp, population))
    if summaries and all("massa_rendimento_considerada" in s for s in summaries):
        for key in ("domicilios", "responsaveis_renda", "responsaveis_com_renda",
                    "setores_sem_renda", "setores_sob_sigilo", "setores_por_massa",
                    "setores_por_media", "setores_universo_renda_suprimido", "total_setores"):
            result[key] = sum(nonnegative(s[key], key, integer=True) for s in summaries)
        mass = sum((nonnegative(Decimal(s["massa_rendimento_considerada"]), "massa_rendimento_considerada")
                    for s in summaries), Decimal(0))
        result["massa_rendimento_considerada"] = format(mass, "f")
        valid, total = result["responsaveis_com_renda"], result["responsaveis_renda"]
        result["renda_media_responsavel"] = float((mass / valid).quantize(Decimal("0.01"), rounding=ROUND_HALF_EVEN)) if valid else None
        result["cobertura_renda_proporcao"] = (round(valid / total, 4) if total and not
            result["setores_universo_renda_suprimido"] else None)
    if not summaries:
        result.update({key: 0 for key in COUNT_KEYS})
        result["massa_rendimento_considerada"] = "0"
    return result


def validate_payload(payload: dict) -> None:
    """Valida estrutura, IDs, vínculos e números finitos sem serializar JSON."""
    def fail(message: str) -> None:
        raise ValueError(message)

    def walk(value: object, *, check_codes: bool = True) -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                if not isinstance(key, str):
                    fail("Chave JSON deve ser textual")
                if check_codes and key in CODE_LENGTHS and not (key == "cd_bairro" and child is None):
                    validate_code(child, key)
                if key == "cd_setores":
                    if not isinstance(child, list):
                        fail("cd_setores deve ser lista")
                    for code in child:
                        validate_code(code, "cd_setor")
                # Metadados de mapeamento contêm nomes de colunas, não códigos.
                walk(child, check_codes=check_codes and key not in {
                    "mapeamento_variaveis_censo", "mapeamento_variaveis_pib",
                    "col_map_setor", "col_map_pib_mun"})
        elif isinstance(value, list):
            for child in value:
                walk(child, check_codes=check_codes)
        elif isinstance(value, float):
            if not math.isfinite(value):
                fail("JSON não admite NaN/Infinity")
        elif value is not None and not isinstance(value, (str, int, bool)):
            fail("Tipo não suportado no JSON")

    if not isinstance(payload, dict) or not isinstance(payload.get("metadata"), dict):
        fail("Payload precisa de metadata")
    walk(payload)
    level = payload["metadata"].get("nivel")
    if level not in {"brasil", "uf", "municipio"}:
        fail("metadata.nivel deve ser brasil, uf ou municipio")
    if level == "brasil":
        validate_indicators(payload.get("resumo_brasil"))
        if not isinstance(payload.get("ufs"), list) or len(payload["ufs"]) != 27:
            fail("Índice deve conter as 27 UFs")
        if not isinstance(payload.get("regioes"), list) or len(payload["regioes"]) != 5:
            fail("Índice deve conter as cinco regiões")
        if "municipios" in payload or "municipios_resumo" in payload:
            fail("Índice nacional não pode embutir municípios")
        for uf in payload["ufs"]:
            if not isinstance(uf, dict) or not isinstance(uf.get("metadata"), dict):
                fail("UF do índice malformada")
            validate_code(uf["metadata"].get("cd_uf"), "cd_uf")
        for record in payload["ufs"]:
            if record.get("resumo_uf") is not None:
                validate_indicators(record["resumo_uf"])
        for region in payload["regioes"]:
            if not isinstance(region, dict) or "indicadores" not in region:
                fail("Região malformada")
            if region["indicadores"] is not None:
                validate_indicators(region["indicadores"])
        return
    uf = validate_code(payload["metadata"].get("cd_uf"), "cd_uf")
    if level == "uf":
        validate_indicators(payload.get("resumo_uf"))
        if "municipios" in payload or not isinstance(payload.get("municipios_resumo"), list):
            fail("UF precisa de municipios_resumo, sem detalhes embutidos")
        records = payload["municipios_resumo"]
    else:
        record = payload.get("municipio")
        if not isinstance(record, dict):
            fail("Detalhe precisa de municipio")
        metadata_code = validate_code(payload["metadata"].get("cd_mun"), "cd_mun")
        if record.get("cd_mun") != metadata_code:
            fail("Município diverge dos metadados")
        records = [record]
    seen_municipalities = set()
    for municipio in records:
        if not isinstance(municipio, dict):
            fail("Registro municipal inválido")
        code = validate_code(municipio.get("cd_mun"), "cd_mun")
        if not code.startswith(uf) or code in seen_municipalities:
            fail("Município duplicado ou fora da UF")
        seen_municipalities.add(code)
        validate_indicators(municipio.get("indicadores"))
        if level == "uf":
            if any(key in municipio for key in ("bairros", "cd_setores")):
                fail("Resumo municipal não pode embutir bairros ou setores")
            if not isinstance(municipio.get("arquivo"), str):
                fail("Resumo municipal precisa de caminho de detalhe")
            continue
        if not isinstance(municipio.get("bairros"), list):
            fail("Município precisa de bairros")
        seen_groups, seen_sectors = set(), set()
        for bairro in municipio["bairros"]:
            if not isinstance(bairro, dict):
                fail("Bairro inválido")
            required = INDICATOR_KEYS | {
                "cd_bairro", "id_agregacao", "nm_bairro", "origem_malha",
                "cd_setores", "metodo_agregacao", "gini_estimado",
            }
            if set(bairro) != required:
                fail("Bairro deve obedecer ao schema único de detalhe")
            validate_indicators({key: bairro[key] for key in INDICATOR_KEYS})
            origin, bairro_code = bairro["origem_malha"], bairro["cd_bairro"]
            group_id = bairro["id_agregacao"]
            if not isinstance(group_id, str) or not group_id.strip() or group_id in seen_groups:
                fail("id_agregacao deve ser textual, preenchido e único")
            seen_groups.add(group_id)
            if origin == "ibge_bairro_oficial":
                validate_code(bairro_code, "cd_bairro")
                if not bairro_code.startswith(code) or group_id != f"bairro:{bairro_code}":
                    fail("Bairro oficial incompatível com município ou id_agregacao")
            elif origin != "setores_agregados" or bairro_code is not None:
                fail("Fallback exige origem setores_agregados e cd_bairro null")
            codes = bairro["cd_setores"]
            if not isinstance(codes, list) or not codes:
                fail("Detalhe deve preservar os códigos dos setores")
            nonnegative(bairro["total_setores"], "total_setores", integer=True)
            if bairro["total_setores"] != len(codes):
                fail("total_setores diverge da lista")
            for sector in codes:
                if not sector.startswith(code) or sector in seen_sectors:
                    fail("Setor fora do município ou contado em mais de um grupo")
                seen_sectors.add(sector)


def write_payload(path: Path, payload: dict) -> None:
    """Valida e serializa uma única vez; publicação atômica por arquivo."""
    validate_payload(payload)
    path.parent.mkdir(parents=True, exist_ok=True)
    # Arquivo temporário exclusivo no mesmo filesystem: uma falha de escrita
    # não deixa o destino parcialmente serializado e não sobrescreve temporários.
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                         suffix=".tmp", delete=False) as stream:
            temp_path = Path(stream.name)
            json.dump(payload, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.write("\n")
        temp_path.replace(path)
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)
