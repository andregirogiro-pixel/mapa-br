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
   (2), CD_MUN (7), CD_BAIRRO (9–10), CD_SETOR (15 dígitos com sufixo
   opcional A–Z no perfil demonstrativo). Usar nomes JSON em
   minúsculas. Em pandas, declarar `dtype` string ao ler; nunca converter
   primeiro para número. No JavaScript, não usar `Number`/`parseInt` nas chaves.
   Validar formato e prefixos UF/município antes de joins. Regex pré-compiladas;
   `normalize_code` remove espaços nas bordas e coloca sufixo em maiúsculas,
   sem converter números ou remover sufixos. Nunca colapsar setores A/B.
   O perfil aceito NÃO confirma a especificação de uma malha: antes de ingerir,
   fixar release, arquivo, dicionário e formato. Não presumir nomes V001/V0001
   ou significados iguais entre arquivos, pesquisas e anos.
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
5. Renda: `domicilios` é o total físico para exibição, NUNCA o peso implícito.
   Exigir `responsaveis_renda` explicitamente, mapeado ao denominador exato
   da variável da fonte (inclusive/exclusive sem rendimento). DPPO só é
   equivalente quando o dicionário confirma esse universo. Todos os setores
   de um grupo devem ter o mesmo universo, unidade e período.
   Sobre o subconjunto V com massa ou média divulgada, usar:
   `sum(massa_i se disponível, senão renda_i * responsaveis_i) / sum(responsaveis_i)`.
   Priorizar massa só quando sua definição corresponde à média e ao universo.
   Excluir renda ausente do numerador E do denominador; conservar população,
   domicílios e universo total. Zero é renda válida. Universo de renda zero
   com renda/massa positiva é inconsistente. Peso válido zero retorna null.
   `status_renda`: divulgada, sigilo ou ausente. O adaptador deve preservar o
   marcador original de sigilo (ex.: X, apenas se definido no dicionário);
   `None` sozinho não comprova sigilo. NaN/Infinity e sentinelas não normalizadas
   são rejeitados. Publicar cobertura válida/total em [0,1] e contagens de
   setores com renda ausente e sob sigilo. A média é condicional à cobertura,
   não uma imputação nem uma estimativa sem viés para todo o bairro.
   Acumular massas/produtos em Decimal, arredondar só a média final a centavos
   com ROUND_HALF_EVEN. Gini sem microdistribuição permanece null.
6. Registrar fonte, período de referência, unidade, método e condição simulada.
   Não exibir números de demonstração como dados oficiais. Distinguir renda do
   responsável, renda domiciliar e renda per capita. `updated_at` é data de
   geração, não ano de referência de cada indicador. `null` significa indisponível.
7. Dados eleitorais futuros: conservar IDs do TSE como strings e registrar
   método/incerteza de correspondência espacial; seção eleitoral não é setor IBGE.

## Contrato JSON (schema_version 1.1)

UTF-8, sem NaN/Infinity. PIB canônico em `pib_mil_reais` (inteiro nas fixtures);
`pib_total_bi` é derivado somente para compatibilidade/apresentação, nunca
somado no pipeline. PIB per capita = PIB em mil reais * 1000 / população.
Uma fonte real com frações exige preservar a escala decimal, sem truncar para
inteiro; o contrato de fixtures atual rejeita PIB fracionário. Outros montantes
em reais e Gini no intervalo [0, 1]. Listas de municípios/bairros de demonstração são
parciais e **não** reconciliam com os totais sintéticos estaduais.

Índice `brasil.json`:

- `metadata`: `schema_version`, `updated_at`, `tipo_dados`, `fonte_geografica`,
  `indicadores` (unidades, referência e fonte), `aviso`, `perfil_codigo_setor`,
  `release_censo`, `universo_renda`, `mapeamento_variaveis_censo`. Release e
  mapeamento permanecem nulos nas fixtures; nenhuma ingestão real foi validada.
- `resumo_brasil`: `populacao`, `pib_mil_reais`, `pib_total_bi`, `pib_per_capita`,
  `renda_media_domiciliar`, `gini`. Agregar apenas medidas compatíveis;
  renda e Gini nacionais/regionais permanecem nulos sem bases adequadas.
- `regioes`: `cd_regiao`, `nm_regiao`, `indicadores`.
- `ufs`: 27 registros com `metadata`, `resumo_uf`, `dados_disponiveis`,
  `arquivo` (caminho relativo ao índice, ou null). Apenas SP e SC têm detalhe.

Partição `uf/{cd_uf}.json`:

- `metadata`: `cd_uf`, `sigla_uf`, `nm_uf`, `cd_regiao`, `nm_regiao`,
  `updated_at`, `schema_version`, `tipo_dados`, `cobertura_municipios`,
  `cobertura_bairros`, `indicadores`, `aviso`.
- `resumo_uf`: os mesmos indicadores de `resumo_brasil`.
- `municipios[]`: `cd_mun`, `nm_mun`, `indicadores` (`populacao`,
  `pib_per_capita`, `renda_media`, `gini`), `bairros[]`.
- Bairro oficial: `cd_bairro`, `nm_bairro`, `origem_malha:
  "ibge_bairro_oficial"`, `populacao`, `domicilios`,
  `renda_media_responsavel`, `gini_estimado`. Na demonstração, esse valor de
  origem representa apenas o cenário do contrato: não há malha real incluída.
- Fallback: os mesmos campos, `cd_bairro: null`, `origem_malha:
  "setores_agregados"`, `id_agregacao`, `cd_setores[]` e
  `responsaveis_renda`, `responsaveis_com_renda`, `setores_sem_renda`,
  `setores_sob_sigilo`, `setores_por_massa`, `setores_por_media`,
  `cobertura_renda_proporcao` e `metodo_agregacao`.
  Método: `massa_por_responsaveis_validos`, `media_ponderada_responsaveis_validos`,
  `massa_e_media_ponderada_responsaveis_validos` ou `sem_renda_divulgada`.
  Cobertura = responsáveis com renda / responsáveis do universo; null se
  universo zero, 0 se universo positivo e nenhuma renda divulgada. A função
  também aceita bairro oficial e verifica seus setores, sem inferir vínculo
  espacial apenas pelo prefixo. Não usar o rótulo percentual para essa proporção.

## Execução e validação

Na raiz: `python3 etl_pipeline/01_build_uf_base.py` e
`python3 -m unittest discover -s etl_pipeline/tests -v`.
O gerador é offline, determinístico para uma mesma `--date` e não requer
instalar bibliotecas geoespaciais. `--output-dir` permite gerar fora do checkout.
Não adicionar frontend, API, geometrias ou estatísticas oficiais sem tarefa
específica. Ao adicionar ingestão real, testar procedência, unidades, joins e
particionamento; manter fixtures pequenas e explicitamente simuladas.
