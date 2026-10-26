# Plataforma analítica do Brasil

## Arquitetura e execução

- Monorepo: `etl_pipeline/` (Python 3.11+), `frontend/` (React + Vite + TypeScript estrito),
  `data/processed/` (JSONs estáticos) e `notebooks/` (exploração).
- Navegação: País → Região → UF → Município → Bairro/Setor.
  Interface planejada: mapa à esquerda e painel analítico à direita, tema escuro.
  O frontend tem cinco níveis, URL compartilhável e cartograma explícito.
  API e geometria real ainda não foram implementadas. O adaptador local
  de arquivos reais está em `02_ingest_ibge_real.py`; não baixa bases.
- Usar o checkout existente. Cada tarefa cloud já é isolada; não criar worktrees
  sem pedido explícito. Não versionar credenciais nem dados brutos pesados.
- Motor único em `core_contract.py`, importado por 01 e 02: não duplicar
  normalização, validação ou agregação nos scripts. Cadastro/metadados em
  `reference_data.py`. Pandas/geopandas/geobr/sidrapy ficam para extração futura;
  o adaptador CSV usa stdlib e Parquet requer pyarrow. FastAPI opcional.
  Não baixar dados nem executar pipeline durante importação de módulos.
- Gerar: `python3 etl_pipeline/01_build_uf_base.py --date 2026-10-25`.
  Testar demo: `python3 -m unittest discover -s etl_pipeline/tests -p test_build_uf_base.py -v`.
  O gerador e seus testes de fixtures usam stdlib. Para a suíte completa com Parquet:
  `.venv/bin/python -m unittest discover -s etl_pipeline/tests -v`.
  `--output-dir` escolhe destino; o adaptador real usa `data/processed_real`
  por padrão, separado das fixtures e ignorado pelo Git.

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
   oficial: origem ibge_bairro_oficial e id_agregacao `bairro:{cd_bairro}`.
5. Indicadores e códigos de bairros/setores são fixtures explicitamente
   simuladas. Nomes e códigos de regiões, UFs e municípios correspondem à
   divisão oficial. updated_at é geração, não referência estatística.
   Fonte, unidade, universo e período devem acompanhar dados reais.
   release_censo e mapeamento_variaveis_censo continuam nulos nas fixtures;
  no adaptador vêm do manifesto, assim como universo e períodos. A declaração
  da release pelo usuário não equivale a verificação externa de autenticidade.
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
  Não ampliar automaticamente a tolerância: outra política requer evidência da
  release e testes próprios. PIB total permanece não negativo; componentes
  setoriais eventualmente assinados exigem indicadores e domínios separados.
- Ausência é excluída do numerador E do denominador válido, mantendo totais
  físicos e universo total. Renda zero é válida. Nenhuma renda válida => null;
  renda/massa positiva com universo zero => erro. Gini sem microdistribuição
  fica null. Nunca calcular Gini pela média de Ginis.
- status_renda: divulgada, sigilo ou ausente, coerente com massa/média.
  Se ambas as medidas estiverem mapeadas, seus status devem ser iguais, inclusive
  para renda zero. Para uma fonte com apenas uma medida, omitir a outra do
  manifesto; não aceitar divulgação misturada com sigilo/ausência na mesma linha.
  O adaptador deve preservar o marcador de sigilo da fonte; None sozinho não
  comprova sigilo. Sentinelas não normalizadas, NaN e Infinity são rejeitados.
- cobertura_renda_proporcao = responsáveis com renda / universo total de renda,
  em [0,1], quatro casas. Universo zero => null; universo positivo sem renda => 0.
  Quando o próprio denominador é X e todas as medidas mapeadas também são X,
  usar peso interno 0 + universo_renda_suprimido true. Contar esses setores e
  publicar cobertura null em todos os níveis. Total de responsáveis nesse caso
  é só a soma conhecida, não o universo completo. Ausência genérica não autoriza
  essa exceção. Média coberta não implica estimativa sem viés de todo o grupo.
- Acumular massas/produtos em Decimal, arredondar somente a média final a
  centavos com ROUND_HALF_EVEN. Os códigos exigem memória O(n); ordenação
  dos códigos custa O(n log n). Não manter lista adicional de produtos.
- PIB canônico em pib_mil_reais (inteiro nas fixtures). Agregar nessa unidade;
  pib_total_bi = pib_mil_reais / 1_000_000 é derivado para apresentação.
  PIB per capita = pib_mil_reais * 1000 / população. Fontes fracionárias exigem
  campo `pib_mil_reais_exato` como string decimal. O adaptador o fornece para
  PIB fracionário; rollups usam esse campo, não a projeção numérica float.
  Sem campo exato o motor mantém a validação inteira das fixtures.

## Contrato JSON 2.0 — quebra deliberada do 1.1

UTF-8, sem NaN/Infinity. Campos indisponíveis são null, nunca zero inventado.
Indicadores macro têm exatamente as 19 chaves de `INDICATOR_KEYS` em
core_contract.py, tanto em 01 quanto 02, em município, UF, região e país:

- populacao, domicilios, responsaveis_renda, responsaveis_com_renda;
- pib_mil_reais, pib_mil_reais_exato, pib_total_bi, pib_per_capita;
- renda_media_domiciliar, renda_media_responsavel, gini;
- total_setores, setores_sem_renda, setores_sob_sigilo, setores_por_massa,
  setores_por_media, setores_universo_renda_suprimido;
- massa_rendimento_considerada, cobertura_renda_proporcao.

`indicators_from_totals` é a projeção única dos totais + PIB. Nunca criar um
subconjunto de sete campos para as fixtures. validate_payload aplica
validate_indicators em todos esses blocos, inclusive nos resumos do índice.
Campos extras/ausentes são erros; inexistência de cobertura territorial no 02
continua representada pelo bloco inteiro null, não por indicadores inventados.
Renda domiciliar e renda do responsável não são aliases. As fixtures não
inventam renda domiciliar ou Gini; deixam null quando não há distribuição.
Municípios demonstrativos e UFs SP/SC agora reconciliam com seus setores/bairros;
resumos das outras 25 UFs derivam de setores internos totalmente sintéticos,
com identificadores de formato não exportados e sem detalhe municipal. Não
interpretar esses setores como registros oficiais. País/regiões somam os
resumos disponíveis pelo mesmo motor, incluindo renda parcial e cobertura.

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
  cobertura_renda_proporcao, setores_universo_renda_suprimido,
  massa_rendimento_considerada (texto decimal exato da soma parcial de renda).
- Indicadores: pib_mil_reais, pib_mil_reais_exato, pib_total_bi, pib_per_capita,
  renda_media_domiciliar, renda_media_responsavel, gini, gini_estimado.

Métodos: massa_por_responsaveis_validos, media_ponderada_responsaveis_validos,
massa_e_media_ponderada_responsaveis_validos ou sem_renda_divulgada.
Não atribuir o mesmo setor a múltiplos bairros do município.

## Escrita e testes

validate_sector_invariants é a validação leve por linha: física, renda, status e
universo suprimido. É chamada pelo adaptador e por aggregate_sectors; nunca
chamar aggregate_sectors([sector]) só para validar uma linha na carga SQLite.
validate_payload verifica estrutura, estados contraditórios, vínculos, códigos
normalizados e números finitos, sem serializar. write_payload usa json.dump uma
única vez por saída e troca atômica por arquivo, com temporário exclusivo.
A publicação do lote inteiro não é transacional. build processa um detalhe
municipal por vez, retendo somente resumos e caminhos; não mantém todos os
bairros/setores nacionais em memória. Atualizar testes e JSONs ao mudar contrato.
Não adicionar API, geometrias ou novas fontes reais sem tarefa específica.

## Adaptação de fontes reais

- Ler [o contrato do manifesto](etl_pipeline/manifests/README.md) antes de
  criar uma release. template.json contém placeholders, não colunas verificadas.
- CSV: DictReader sem inferência. Parquet: inspecionar schema antes de qualquer
  linha, recusando códigos numéricos mesmo em arquivos vazios. Nomes físicos
  de colunas vêm exclusivamente dos mapeamentos do manifesto. Moeda (renda,
  massa e PIB) em Parquet exige string/large_string ou decimal128/256. Float,
  inclusive NaN, é recusado pelo schema, sem arredondamento corretivo. Strings
  Parquet usam parquet_decimal_separator (padrão ponto), independente do locale
  CSV. Null Arrow continua ausência; não inferir sigilo de null/NaN.
- parse_ibge_numeric distingue divulgação, sigilo e ausência, com Decimal;
  não converter X para zero de renda. Demografia/denominador ausentes abortam,
  salvo a exceção estrita do denominador sob sigilo descrita acima.
- Agrupar bairro oficial pelo código; fallback por subdistrito e macro-situação.
  Distrito/subdistrito explícitos devem coincidir com prefixos do setor. Códigos
  dummy 0/vazios/*000 não são bairros oficiais. Não chamar um fallback de bairro
  oficial; os rótulos dizem Setores Agregados. Ordenar oficiais antes de fallback.
- Somar bairros para reconciliar população, domicílios, responsáveis, peso válido
  e massa considerada com os totais calculados sobre TODOS os setores municipais.
  Não usar médias de bairros arredondadas para calcular média municipal.
- Join exato PIB/Censo por município; filtrar explicitamente somente corpos
  d'água 4300001/4300002 nas duas fontes. Falhar em duplicatas e conjuntos distintos.
- Rollups UF/região/país são bottom-up. Fora do recorte fornecido, resumos são
  null, não zeros fabricados. O join não comprova completude setorial: conferir
  o inventário oficial de setores por município antes de afirmar cobertura total.
- Arquivos de território, população e renda separados devem ser consolidados
  previamente em um arquivo 1:1 por setor. Esse join entre arquivos e a confirmação
  dos nomes/universos em uma release oficial ainda dependem da fonte escolhida.
- SQLite temporário aceita entrada fora de ordem, com setores em disco e carga
  de um município por vez. Destino novo/vazio por release; arquivos antigos não
  são apagados automaticamente. Escrita é atômica por arquivo, não por lote.

## Frontend: contrato, navegação e geometrias

- Ler frontend/README.md para executar. Node >=22.12, validado em Node 24;
  usar npm ci com o lockfile. Comandos em frontend/: npm run dev, npm test,
  npm run build e npm run test:e2e (após build; requer Chromium).
- src/types/contract.ts valida JSON em runtime com Zod e espelha as 19 chaves
  do motor Python, obrigatórias e nullable onde necessário. strictNullChecks
  está habilitado. Não converter IDs em números. Textos decimais exatos ficam
  como texto; os cálculos visuais usam somente projeções numéricas.
- Resolver arquivo relativo sempre por new URL(arquivo, parentFileUrl).
  Municipio.arquivo se refere ao JSON de UF, não à raiz dos dados. Não usar
  concatenação da raiz para os descendentes. Carregar país primeiro, UF sob
  demanda e detalhe municipal só depois da seleção correspondente.
- DataLoader mantém Map de Promises por URL. Erros saem do cache. Cada consumidor
  tem sinal próprio; só abortar o transporte compartilhado quando não restarem
  consumidores. Limpeza dos efeitos aborta navegações antigas e impede resposta
  tardia de publicar seleção obsoleta. Recarregar a página ao trocar releases.
- useGeoStore.ts usa Zustand com provider por aplicação; navigation é a união
  discriminada, não um conjunto de IDs nullable independentes. Registrar o
  vínculo UF/região do índice para voltarNivel; nunca preservar a região de
  outra UF. Ações validam IDs antes de URLSearchParams, sem String(code).
  Métrica compartilhada: população, renda, PIB per capita, PIB em bilhões,
  cobertura e quantidade de setores sob sigilo.
- Navegação é união discriminada pais/regiao/uf/municipio/bairro, sincronizada
  com query params e popstate. Trocar UF substitui o estado e limpa descendentes.
  Validar links profundos, prefixos e pertencimento dos registros ao pai.
- No nível 5, usar SEMPRE id_agregacao como key e seleção, nunca cd_bairro.
  Mostrar origem, sigilo, cobertura desconhecida e os códigos dos setores.
  Renda do responsável não é renda domiciliar. Null não vira zero.
- Se cobertura arredondada no JSON for 1, mas responsáveis válidos < total,
  usar os totais conhecidos e mostrar <100% quando necessário. Denominador
  suprimido continua cobertura desconhecida. Isso não imputa renda omitida.
- A interface atual exibe cartograma esquemático de UFs e cartões territoriais;
  não há polígonos oficiais ou zoom geográfico real. Não confundir os retângulos
  com limites territoriais. buildSectorToGroupMap/groupForSectorFeature preparam
  o join reverso CD_SETOR (string) -> id_agregacao para uma malha municipal
  futura, atendendo oficial/fallback sem dissolve. Recusar setores duplicados
  e códigos numéricos; features sem vínculo não herdam um grupo arbitrário.
- O build copia dados em partições fora do bundle. O dev serve a mesma árvore.
  MAPA_BR_DATA_DIR seleciona outra árvore local; VITE_DATA_URL muda o índice
  remoto e VITE_BASE_PATH muda o prefixo de publicação. Não importar todos os
  JSONs no código da aplicação (fixtures de testes são a única exceção).

Aliases TS canônicos são inferidos de Zod, não interfaces duplicadas. Resumos
municipais exigem total_bairros e total_setores inteiros, não opcionais/nullable.
UFs sem detalhe precisam respeitar ambas as condições: dados_disponiveis e
arquivo não vazio. Manter o resumo e exibir indisponibilidade sem fetch fictício.
Não substituir resolução pelo arquivo pai por remoção de ../ nem criar uma
segunda raiz /data paralela à árvore já servida pelo Vite.
