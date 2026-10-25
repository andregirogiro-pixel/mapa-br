"""Cadastro geográfico e metadados comuns, sem acesso à rede."""
from etl_pipeline.core_contract import MEAN_TOLERANCE, COUNT_KEYS

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
def indicator_metadata() -> dict:
    units = {
        "populacao": "pessoas", "domicilios": "domicílios",
        "pib_mil_reais": "mil BRL/ano, preços correntes",
        "pib_mil_reais_exato": "mil BRL/ano, preços correntes; texto decimal exato",
        "pib_total_bi": "bilhões de BRL/ano (derivado)", "pib_per_capita": "BRL/pessoa/ano",
        "responsaveis_renda": "pessoas no universo da variável de renda",
        "responsaveis_com_renda": "pessoas em setores com massa ou média divulgada",
        "cobertura_renda_proporcao": "proporção [0,1] do universo de renda coberto",
        "massa_rendimento_considerada": "BRL/mês; texto decimal da soma parcial divulgada/reconstruída",
        "setores_universo_renda_suprimido": "setores com denominador de renda sob sigilo",
        "renda_media_domiciliar": "BRL/domicílio/mês",
        "renda_media_responsavel": "BRL/responsável/mês",
        "gini": "índice [0,1]", "gini_estimado": "índice [0,1]",
    }
    for name in sorted(COUNT_KEYS):
        units.setdefault(name, "setores")
    return {
        name: {"unidade": unit, "periodo_referencia": None,
               "fonte": "fixture sintética; sem período estatístico real"}
        for name, unit in units.items()
    }


def common_metadata(updated_at: str) -> dict:
    return {
        "schema_version": "2.0", "updated_at": updated_at,
        "tipo_dados": "simulados",
        "fonte_geografica": "Cadastro de códigos e nomes de UFs/regiões IBGE",
        "indicadores": indicator_metadata(), "aviso": AVISO,
        "perfil_codigo_setor": "15_digitos_sufixo_maiusculo_opcional",
        "release_censo": None,
        "universo_renda": "fixture: responsáveis DPPO, inclusive sem rendimento",
        "mapeamento_variaveis_censo": None,
        "tolerancia_media_renda_brl": str(MEAN_TOLERANCE),
    }
