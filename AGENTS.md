# Plataforma analítica do Brasil

## Arquitetura e execução

- Monorepo: `etl_pipeline/` (Python 3.11+), `frontend/` (React + Vite + TypeScript estrito),
  `data/processed/` (JSONs estáticos) e `notebooks/` (exploração).
- Navegação: País → Região → UF → Município → Bairro/Setor.
  Interface planejada: mapa à esquerda e painel analítico à direita, tema escuro.
  O frontend tem cinco níveis, URL compartilhável e mapa de polígonos sintéticos.
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
- MapViewport renderiza MapLibre com estilo local vazio, sem tiles/glyphs/sprites
  externos. O componente/biblioteca são carregados sob demanda. promoteId usa
  cd_uf/cd_mun/cd_setor strings; feature-state colore indicadores e seleciona
  todos os setores do grupo via id_agregacao. Manter botões como alternativa
  acessível. Indicar sempre que são formas SINTÉTICAS, nunca limites oficiais.
- build_demo_geometries.py lê SOMENTE fixtures simuladas, resolve caminhos
  relativos ao pai, valida com core e gera 7 arquivos em frontend/public/geo/demo.
  Esta subpasta pequena é versionada; geometrias reais continuam ignoradas.
  O manifesto guarda hashes tabulares; o cliente valida conjuntos de IDs e
  vínculos territoriais/grupos, não os hashes. Regenerar após mudar as fixtures.
- demoGeometry.ts carrega UFs, municípios por UF e setores por município lazy,
  com cache/cancelamento do DataLoader. Recusa inventários diferentes, duplicatas,
  IDs numéricos e grupos incoerentes. Usar a malha setorial única para oficial
  e fallback, sem dissolve. UF sem dados não busca malha municipal inexistente.
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

## Download e staging 2022 (03)

- Ler etl_pipeline/FETCHING_IBGE.md e etl_pipeline/IBGE_2022_AUDIT.md. O usuário
  escolheu Censo 2022; não usar FTP, variáveis ou dicionário de 2010 como 2022.
  Na tentativa de 2026-10-26, FTP/SIDRA responderam 200 e malhas 503. Não repetir
  que todo acesso IBGE continua bloqueado por 403. O perfil executável continua
  pendente: o bloqueio principal agora é estatístico, não o download do Censo.
- Dicionário básico 20260520: v0001 = pessoas, v0002 = domicílios físicos totais.
  Atenção à caixa real dos cabeçalhos CSV. Renda 20260508: V06001 = responsáveis
  em DPPO; V06004 = média dos responsáveis COM rendimentos. Não atribuir V06001
  como peso de V06004: a comparação com agregados municipais oficiais divergiu.
  Nenhum dos dois dicionários conferidos oferece explicitamente a contagem dos
  responsáveis com rendimentos ou massa do mesmo universo.
- O utilitário audits/verify_2022_sc.py é diagnóstico, não ingestão. Os relatórios
  completos e dados baixados ficam em data/raw, ignorados pelo Git. O catálogo
  manifests/ibge_2022_sources.audit.json registra evidências e bloqueios; não é
  argumento válido de --source-profile. Não publicar médias desse mapeamento.
- Inventário observado de SC: básico 16.736 setores; renda 16.435. As 301 linhas
  ausentes da renda têm população zero e 230 domicílios físicos no total. Não
  excluir esses domicílios nem inventar X para preencher o join. O básico usa
  ponto literal em bairros ausentes e tem 38 setores CD_SIT=9; ambos precisam
  de política explícita da release antes de adaptar, sem converter 9 em rural.
- ibge_padrao.json é contrato do CSV preparado, não dicionário bruto. Perfil de
  fontes separado declara cada tabela, período, URL/diretório, membro ZIP,
  encoding, delimitador, decimal e mapeamentos. Domicílios devem ser total físico.
- Compartilhar denylist e validações com core/02. Download stdlib mantém TLS/
  proxy e verifica integridade local de cache. SHA local não é assinatura IBGE.
- SIDRA usa ano explícito, confere dimensão/unidade/variável e filtra somente
  extras do PIB. Não apagar municípios censitários sem PIB por interseção.
- Join 1:1 em SQLite; nunca all_sectors nacional em RAM. ZIP nacional é lido uma
  vez por tabela; arquivos de UF não podem introduzir setores de outra UF.
- Não alterar pop, domicílios, peso, situação desconhecida nem transformar sigilo
  em zero para passar validação. Erros geram relatório e impedem publicação.
  Nomes só são normalizados por caixa, espaços e NFC; divergência real é erro.
- Reconstrução renda média * peso é exata sobre os números publicados, mas não
  recupera massa original perdida por arredondamento. Documentar essa origem.
- Saída real exige diretório vazio; não sobrescrever fixtures. Cada staging tem
  um diretório run-* novo, estado ready/failed e relatório completo. Proveniência
  compacta no JSON, sem listas municipais nacionais e sem reescrita de todos
  os arquivos depois de ingest. Malhas ficam fora do Git, com fontes e período
  solicitado. Sem validação online não afirmar compatibilidade setorial.

## Política de geometrias e independência da demo

- O frontend e seu build não dependem de servicodados.ibge.gov.br ou www.ibge.gov.br.
  O 03 é exclusivamente tabular; --download-geojson é recusado, padrão false.
  Não reintroduzir API de Malhas nem portal como fonte ou fallback. A demo roda
  offline após instalar dependências e não depende da auditoria real blocked.
- Para malhas oficiais futuras, ler etl_pipeline/GEOMETRIES.md. Usar exclusivamente
  arquivos estáticos em ftp.ibge.gov.br/geoftp.ibge.gov.br, release e dicionário
  verificados. Nada de inferir compatibilidade pelo nome do arquivo.
- Auditoria real ainda não implementada: exigir CRS e polígonos válidos, códigos
  textuais no schema original, conjuntos 1:1 sem duplicatas com TODOS os 16.736
  setores do básico SC (inclusive os 301 sem renda), prefixos e denylist compartilhada
  WATER_BODY_DENYLIST. Nunca testar completude só contra os 16.435 da renda.

## Componentes de análise e React Query

- geoStats.ts é o motor único de métricas visuais: catálogo, quantis reais R-7,
  formatação e bounding box. Não chamar escala linear de quantis. Ausência não
  comprova sigilo; escala vazia tem min/max null. Preservar cobertura desconhecida
  e <100% quando há responsáveis excluídos conhecidos. Decimais exatos ficam texto.
- App usa React Query por montagem, staleTime/gcTime Infinity, retry1 e
  networkMode always (a demo local independe de navigator.onLine). Delegar carga
  hierárquica ao DataLoader existente, com validação e AbortSignal. Não criar
  caches paralelos de fetch sem validação nem symlink public/data.
- MapViewport mantém uma instância e 3 fontes promoteId textual. Não recriar
  WebGL nem refazer fetch ao trocar métrica. Limpar feature-state de recortes
  antigos e abortar geometria pendente. cd_setor minúsculo é o campo da demo;
  o helper de futura malha oficial continua aceitando CD_SETOR conforme a fonte.
- PIB indisponível em bairros: metricaDoMapa aplica fallback para renda no mapa,
  legenda/ranking intramunicipal e tooltip, com aviso; preserva a seleção da store
  e o KPI municipal. Voltar à UF retoma PIB. Não pintar renda sob legenda de PIB.
- AnalyticalSidebar concentra KPIs e auditoria, preservando totais desconhecidos
  como ausência e valores exatos como strings. UFs sem detalhe permanecem
  selecionáveis pelo resumo; não desabilitar acesso a essas 25 UFs.

## Sidecar TSE

- Ler frontend/TSE_SIDECAR.md. tseContract.ts é separado de contract.ts: não
  acrescentar votos aos 19 indicadores/bairros do Censo. Servir arquivos por
  tse/{cd_uf}/{cd_mun}.json na raiz dos dados; uma eleição/cargo/turno por release.
- IDs TSE são strings canônicas: município5, zona4, local4 e id_local composto.
  Nunca inferir município IBGE a partir de código TSE, nome de bairro ou coerção.
- Validar votos, proporções HALF_EVEN/4casas e somas com BigInt. Denominador zero
  implica null. Reconciliar resumo, todos os locais, referências e grupos/seções;
  cobertura alocada pondera aptos, não quantidade de locais. Não incluir pleitos
  com múltiplos votos por cargo nesse contrato sem revisão metodológica.
- Compartilhar objeto-base antes de .superRefine: ZodEffects não tem .extend em
  Zod3. Todos os objetos TSE são strict; validarVinculoTse confere setor/grupo
  contra o município IBGE carregado e a proveniência, sem modificar o Censo.
- Georreferenciado não implica alocado. Campos de setor/grupo são ambos null ou
  ambos preenchidos. Conservar locais não alocados na contabilidade municipal.
  Partição de IDs não prova contenção espacial: fronteiras, CRS, sobreposições
  e pontos ambíguos exigem malha auditada e política do futuro produtor espacial.
- metadata.tipo_dados default fonte_tse_declarada; simulados é explícito. Não
  sobrepor pontos/votos reais em malhas sintéticas nem misturar no sentido inverso.
  Dados eleitorais simulados atuais existem apenas nos testes; não há ETL TSE real.
- Carga eleitoral é opt-in apenas em município/bairro, com DataLoader e React
  Query, sinal e cache. Só404 vira indisponibilidade; outros erros são visíveis.
  Requisições JSON incluem Accept application/json; não aceitar fallback HTML.
- MapViewport usa fonte de pontos id_local, acima dos polígonos, sem distribuir
  votos pela área ou fabricar centroides. Hover/click do ponto não aciona o
  polígono inferior. TsePanel cruza por id_agregacao e mostra aviso metodológico,
  distinguindo votos em locais do perímetro de residência dos eleitores.
