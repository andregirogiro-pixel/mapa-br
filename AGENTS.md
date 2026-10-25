# Plataforma analítica do Brasil

## Escopo e arquitetura

- Monorepo: `etl_pipeline/` (Python 3.11+), `frontend/` (futuro React + Vite),
  `data/processed/uf/` (partições estáticas) e `notebooks/` (exploração).
- Navegação: País → Região → UF → Município → Bairro ou Setor Censitário.
- Interface planejada: mapa coroplético à esquerda, cards, rankings e dispersão
  à direita; tema escuro analítico. O frontend ainda não foi implementado.
- Usar o checkout existente; cada tarefa cloud já é isolada. Não criar worktrees
  sem pedido explícito. Não versionar credenciais nem dados brutos pesados.
- Não baixar dados automaticamente ao importar módulos. Ingestão real futura:
  pandas, geopandas, geobr e sidrapy; API FastAPI é opcional.

## Regras de dados obrigatórias

1. Códigos IBGE são **strings**, nunca números: CD_REGIAO (1 dígito), CD_UF
   (2), CD_MUN (7), CD_BAIRRO (9–10), CD_SETOR (15). Usar nomes JSON em
   minúsculas. Em pandas, declarar `dtype` string ao ler; nunca converter
   primeiro para número. No JavaScript, não usar `Number`/`parseInt` nas chaves.
   Validar tamanho, dígitos e prefixos UF/município antes de joins.
2. Carga inicial: apenas resumo nacional, cinco regiões e 27 UFs em
   `data/processed/brasil.json`. Nunca incluir listas municipais, bairros ou
   setores nesse índice. Geometria inicial futura: só limites nacionais/UFs.
3. Municípios, bairros e setores são carregados por UF, somente após seleção:
   `data/processed/uf/{cd_uf}.json`. Não gerar um GeoJSON/JSON nacional com
   todos os municípios ou bairros. Geometrias detalhadas também serão
   particionadas; para volumes grandes, subdividir por município.
4. Não fabricar códigos oficiais para agregações. Sem bairro oficial,
   preservar `cd_setores` como strings, usar `cd_bairro: null` (ausência de
   código), `id_agregacao` separado e `origem_malha: "setores_agregados"`.
   O consumidor usa `cd_bairro ?? id_agregacao` como chave. Nenhum código
   presente pode ser numérico. A escolha de grupos exige vínculo territorial
   validado; não deduzir bairros a partir do prefixo de setores.
5. Para renda no fallback: `sum(renda_i * domicilios_i) / sum(domicilios_i)`.
   Somar população e domicílios. Domicílios zero não pesam; ausência de renda
   com peso positivo invalida o cálculo. Peso total zero retorna `null`.
   Gini não é aditivo nem média ponderada de Ginis: sem microdistribuição,
   `gini_estimado: null`. Não usar renda zero como substituto de dado ausente.
6. Registrar fonte, período de referência, unidade, método e condição simulada.
   Não exibir números de demonstração como dados oficiais. Distinguir renda do
   responsável, renda domiciliar e renda per capita. `updated_at` é data de
   geração, não ano de referência de cada indicador. `null` significa indisponível.
7. Dados eleitorais futuros: conservar IDs do TSE como strings e registrar
   método/incerteza de correspondência espacial; seção eleitoral não é setor IBGE.

## Contrato JSON (schema_version 1.0)

UTF-8, sem NaN/Infinity. Montantes em reais, salvo `pib_total_bi` em bilhões;
Gini no intervalo [0, 1]. Listas de municípios/bairros de demonstração são
parciais e **não** reconciliam com os totais sintéticos estaduais.

Índice `brasil.json`:

- `metadata`: `schema_version`, `updated_at`, `tipo_dados`, `fonte_geografica`,
  `indicadores` (unidades, referência e fonte), `aviso`.
- `resumo_brasil`: `populacao`, `pib_total_bi`, `pib_per_capita`,
  `renda_media_domiciliar`, `gini`. Agregar apenas medidas compatíveis;
  renda e Gini nacionais/regionais permanecem nulos sem bases adequadas.
- `regioes`: `cd_regiao`, `nm_regiao`, `indicadores`.
- `ufs`: 27 registros com `metadata`, `resumo_uf`, `dados_disponiveis`,
  `arquivo` (caminho relativo ao índice, ou null). Apenas SP e SC têm detalhe.

Partição `uf/{cd_uf}.json`:

- `metadata`: `cd_uf`, `sigla_uf`, `nm_uf`, `cd_regiao`, `nm_regiao`,
  `updated_at`, `schema_version`, `tipo_dados`, `cobertura_municipios`,
  `cobertura_bairros`, `indicadores`, `aviso`.
- `resumo_uf`: os mesmos cinco indicadores de `resumo_brasil`.
- `municipios[]`: `cd_mun`, `nm_mun`, `indicadores` (`populacao`,
  `pib_per_capita`, `renda_media`, `gini`), `bairros[]`.
- Bairro oficial: `cd_bairro`, `nm_bairro`, `origem_malha:
  "ibge_bairro_oficial"`, `populacao`, `domicilios`,
  `renda_media_responsavel`, `gini_estimado`. Na demonstração, esse valor de
  origem representa apenas o cenário do contrato: não há malha real incluída.
- Fallback: os mesmos campos, `cd_bairro: null`, `origem_malha:
  "setores_agregados"`, `id_agregacao`, `cd_setores[]` e
  `metodo_agregacao: "media_ponderada_domicilios"`.

## Execução e validação

Na raiz: `python3 etl_pipeline/01_build_uf_base.py` e
`python3 -m unittest discover -s etl_pipeline/tests -v`.
O gerador é offline, determinístico para uma mesma `--date` e não requer
instalar bibliotecas geoespaciais. `--output-dir` permite gerar fora do checkout.
Não adicionar frontend, API, geometrias ou estatísticas oficiais sem tarefa
específica. Ao adicionar ingestão real, testar procedência, unidades, joins e
particionamento; manter fixtures pequenas e explicitamente simuladas.
