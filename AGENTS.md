# Plataforma analítica do Brasil

## Arquitetura e execução

- Monorepo: `etl_pipeline/` (Python 3.11+), `frontend/` (futuro React + Vite),
  `data/processed/` (JSONs estáticos) e `notebooks/` (exploração).
- Navegação: País → Região → UF → Município → Bairro/Setor.
  Interface planejada: mapa à esquerda e painel analítico à direita, tema escuro.
  Frontend, API, geometria e ingestão real ainda não foram implementados.
- Usar o checkout existente. Cada tarefa cloud já é isolada; não criar worktrees
  sem pedido explícito. Não versionar credenciais nem dados brutos pesados.
- Ingestão futura: pandas, geopandas, geobr e sidrapy; FastAPI opcional.
  Não baixar dados nem executar pipeline durante importação de módulos.
- Gerar: `python3 etl_pipeline/01_build_uf_base.py --date 2026-10-25`.
  Testar: `python3 -m unittest discover -s etl_pipeline/tests -v`.
  Ambos são offline e usam só a biblioteca padrão. `--output-dir` escolhe destino.

## Regras de códigos e fontes

1. Códigos IBGE sempre strings: CD_REGIAO (1 dígito), CD_UF (2), CD_MUN (7),
   CD_BAIRRO (9–10), CD_SETOR (15 dígitos e sufixo opcional A–Z no perfil demo).
   Esse perfil NÃO foi verificado contra uma release real da malha IBGE.
2. Fixar release, arquivo, dicionário e perfil antes da ingestão real. Não
   presumir significados de V001/V0001 entre arquivos, pesquisas e anos.
   Declarar dtype textual na leitura, sem conversão numérica intermediária.
   No JavaScript, não usar Number/parseInt nas chaves.
3. `normalize_code` é usado nas entradas da agregação e na geração de fixtures:
   remove espaços nas bordas, coloca sufixos em maiúsculas, mantém zeros e
   sufixos. Nunca inventar dígitos ou colapsar setores A/B. Regex pré-compiladas;
   validar prefixos e duplicatas depois da normalização.
4. Vínculo territorial deve ser validado na fonte/espacialmente. Prefixo só
   comprova coerência do código municipal, não pertencimento a bairro.
   Sem bairro oficial: cd_bairro null e id_agregacao textual próprio. Com bairro
   oficial: origem ibge_bairro_oficial e id_agregacao igual a cd_bairro.
5. Indicadores e códigos de bairros/setores são fixtures explicitamente
   simuladas. Nomes e códigos de regiões, UFs e municípios correspondem à
   divisão oficial. updated_at é geração, não referência estatística.
   Fonte, unidade, universo e período devem acompanhar dados reais.
   release_censo e mapeamento_variaveis_censo continuam nulos nas fixtures.
6. IDs futuros do TSE permanecem strings. Seção eleitoral não é setor IBGE;
   registrar método e incerteza de correspondência espacial.

## Matemática e qualidade

- domicilios = total físico para exibição; responsaveis_renda = universo exato
  da renda (inclusive/exclusive sem rendimento conforme dicionário). Nunca
  inferir peso a partir de domicílios totais. DPPO só é equivalente se a fonte
  confirmar. Exigir inteiros não negativos e responsáveis <= população E
  responsáveis <= domicílios em cada setor; domicílios podem exceder população.
- Todos os setores do grupo devem ter mesmo período, unidade e universo.
  Sobre V, subconjunto com renda divulgada e peso positivo:
  soma(massa_i se disponível, senão média_i * responsáveis_i) / soma(responsáveis_i).
  Massa tem prioridade, desde que pertença ao mesmo universo. Se massa E média
  existem, exigir abs(massa - média * peso) <= 0.05 * peso, em Decimal.
  Essa tolerância é política do contrato demo, não certificação universal IBGE.
  Coerência numérica não substitui verificação semântica no dicionário.
- Ausência é excluída do numerador E do denominador válido, mantendo totais
  físicos e universo total. Renda zero é válida. Nenhuma renda válida => null;
  renda/massa positiva com universo zero => erro. Gini sem microdistribuição
  fica null. Nunca calcular Gini pela média de Ginis.
- status_renda: divulgada, sigilo ou ausente, coerente com massa/média.
  O adaptador deve preservar o marcador de sigilo da fonte; None sozinho não
  comprova sigilo. Sentinelas não normalizadas, NaN e Infinity são rejeitados.
- cobertura_renda_proporcao = responsáveis com renda / universo total de renda,
  em [0,1], quatro casas. Universo zero => null; universo positivo sem renda => 0.
  Média coberta não implica estimativa sem viés da renda de toda a população.
- Acumular massas/produtos em Decimal, arredondar somente a média final a
  centavos com ROUND_HALF_EVEN. Os códigos exigem memória O(n); ordenação
  dos códigos custa O(n log n). Não manter lista adicional de produtos.
- PIB canônico em pib_mil_reais (inteiro nas fixtures). Agregar nessa unidade;
  pib_total_bi = pib_mil_reais / 1_000_000 é derivado para apresentação.
  PIB per capita = pib_mil_reais * 1000 / população. Fontes fracionárias exigem
  adaptação decimal explícita; o contrato demo rejeita frações sem truncar.

## Contrato JSON 2.0 — quebra deliberada do 1.1

UTF-8, sem NaN/Infinity. Campos indisponíveis são null, nunca zero inventado.
Indicadores macro com mesmos nomes em país, região, UF e município:
`populacao`, `pib_mil_reais`, `pib_total_bi`, `pib_per_capita`,
`renda_media_domiciliar`, `renda_media_responsavel`, `gini`.
Renda domiciliar e do responsável são conceitos diferentes e nunca aliases.
Não usar mais renda_media. País/região não agregam renda sem os pesos corretos.
Bairros expõem esses mesmos campos, com PIB, renda domiciliar e Gini nulos
quando não disponíveis; renda do responsável vem dos setores.
Amostras municipais/bairros são parciais e não reconciliam com totais estaduais.

Carga progressiva, caminhos canônicos (não usar 42_SC.json):

1. `data/processed/brasil.json`: metadata.nivel = brasil, resumo_brasil,
   cinco regioes com indicadores, 27 ufs com metadata/resumo_uf,
   dados_disponiveis e arquivo relativo a este índice, ou null.
   Nunca embutir municípios/bairros/setores na carga nacional.
2. `data/processed/uf/{cd_uf}.json`: metadata.nivel = uf, resumo_uf e
   municipios_resumo com cd_mun, nm_mun, indicadores, total_bairros,
   total_setores e arquivo relativo ao arquivo da UF, por exemplo
   `../municipios/42/4205407.json`. Sem bairros ou arrays de setores.
3. `data/processed/municipios/{cd_uf}/{cd_mun}.json`: metadata.nivel = municipio,
   cd_uf/cd_mun nos metadados e objeto municipio com cd_mun, nm_mun,
   indicadores e bairros. Só carregar ao selecionar o município.
   Para volumes maiores, subdividir também por bairro; nunca consolidar todos
   os municípios/setores nacionais num arquivo. Geometrias seguem a mesma regra.

Todos os bairros (oficiais ou fallback) passam por aggregate_sectors e possuem
exatamente estas chaves:

- Identificação: cd_bairro (string oficial ou null), id_agregacao (sempre
  preenchido), nm_bairro, origem_malha (ibge_bairro_oficial/setores_agregados).
- Linhagem: cd_setores (strings, apenas no detalhe municipal), total_setores,
  metodo_agregacao, setores_por_massa, setores_por_media.
- Totais/qualidade: populacao, domicilios, responsaveis_renda,
  responsaveis_com_renda, setores_sem_renda, setores_sob_sigilo,
  cobertura_renda_proporcao.
- Indicadores: pib_mil_reais, pib_total_bi, pib_per_capita,
  renda_media_domiciliar, renda_media_responsavel, gini, gini_estimado.

Métodos: massa_por_responsaveis_validos, media_ponderada_responsaveis_validos,
massa_e_media_ponderada_responsaveis_validos ou sem_renda_divulgada.
Não atribuir o mesmo setor a múltiplos bairros do município.

## Escrita e testes

validate_payload verifica estrutura, estados contraditórios, vínculos, códigos
normalizados e números finitos, sem serializar. write_payload usa json.dump uma
única vez por saída e troca atômica por arquivo, com temporário exclusivo.
A publicação do lote inteiro não é transacional. build processa um detalhe
municipal por vez, retendo somente resumos e caminhos; não mantém todos os
bairros/setores nacionais em memória. Atualizar testes e JSONs ao mudar contrato.
Não adicionar frontend, API, geometria ou ingestão real sem tarefa específica.
