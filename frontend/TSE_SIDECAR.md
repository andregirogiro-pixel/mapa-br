# Sidecar municipal TSE — contrato 2.0

`tseContract.ts` é independente dos schemas socioeconômicos. Nenhuma variável
eleitoral foi acrescentada aos 19 indicadores do Censo nem aos bairros. O arquivo
municipal é servido em `data/processed/tse/{cd_uf}/{cd_mun}.json`, relativo à mesma
raiz do índice Brasil. Vite aceita essa subárvore no desenvolvimento e a copia
no build, mantendo o particionamento. Em releases reais, usar data/processed_real
(ignorado pelo Git) com MAPA_BR_DATA_DIR, incluindo as duas fontes compatíveis.

## Escopo e proveniência

Uma árvore de release contém um recorte eleitoral explícito por município:
ano_eleicao, nr_turno e cargo nos metadados. O caminho atual não seleciona múltiplos
pleitos simultaneamente. Trocar a release exige recarregar a aplicação para
limpar os caches imutáveis da sessão. Códigos TSE, zona, local e IBGE são strings;
não inferir CD_MUN IBGE de CD_MUN TSE ou do nome do bairro informado pelo TSE.
O produtor deve documentar a ponte oficial TSE–IBGE e as versões utilizadas.

A metadata acrescenta `tipo_dados`: `simulados` ou `fonte_tse_declarada` (default
quando omitido). Isso impede misturar pontos/votos reais com polígonos sintéticos,
ou sidecar simulado com Censo real. A declaração não autentica a fonte. updated_at
é uma data ISO YYYY-MM-DD; não substitui ano da eleição ou versão da malha.

Não há ingestão TSE real, geocodificador ou novos dados eleitorais publicados
neste passo. Os exemplos ficam EXCLUSIVAMENTE nos testes, identificados como
simulados. Na demo normal, ativar TSE retorna indisponibilidade enquanto não
houver sidecar compatível. Não preencher ausências com votos zero.

## Contabilidade e proporções

Contagens são inteiros não negativos seguros para JavaScript. As somas de
validação usam BigInt para não perder exatidão. Um local tem nr_secoes positivo.
O contrato pressupõe um voto por cargo por eleitor presente:

- comparecimento + abstencao = eleitores_aptos;
- votos_nominais + votos_legenda = votos_validos;
- votos_validos + votos_brancos + votos_nulos = comparecimento.

O produtor real deve conferir as regras do cargo e do pleito, as categorias de
votos e os universos publicados. Eleições com múltiplas vagas/votos por cargo
(como certos pleitos para Senado) precisam de outra especificação; não alterar
ou descartar votos para fazer esta contabilidade passar. Também não somar
comparecimento repetido nas linhas de cada candidato ao consolidar seções.

Proporções são canônicas com QUATRO casas decimais, ROUND_HALF_EVEN:

| Campo | Numerador / denominador |
| --- | --- |
| comparecimento_proporcao | comparecimento / eleitores_aptos |
| abstencao_proporcao | abstencao / eleitores_aptos |
| votos_validos_proporcao | votos_validos / comparecimento |
| votos_brancos_proporcao | votos_brancos / comparecimento |
| votos_nulos_proporcao | votos_nulos / comparecimento |
| cobertura_alocacao_eleitorado | aptos dos locais alocados / aptos municipais |

Denominador zero exige null, não zero. A validação reproduz o arredondamento
com razão inteira BigInt, equivalente a Decimal + ROUND_HALF_EVEN no futuro
produtor Python. Não exige que proporções arredondadas independentemente somem
exatamente 1. Para exibir cobertura, a UI usa os totais conhecidos e mostra
<100% se o arredondamento do JSON ocultar uma parcela não alocada.

O objeto-base de indicadores é compartilhado antes de aplicar superRefine;
o resumo municipal estende o objeto-base e reutiliza a validação. Isso evita
chamar .extend em ZodEffects, incompatível com Zod 3. Todos os objetos são strict.

## Referências e universos espaciais

- id_local deve corresponder exatamente a município TSE, zona e local, sem
  duplicatas. Um setor alocado precisa ter prefixo do município IBGE.
- Método e coordenadas são coerentes. Um local com coordenadas pode NÃO estar
  alocado; sem coordenadas nunca pode estar alocado. cd_setor_alocado e
  id_agregacao_alocada são ambos preenchidos ou ambos null.
- Georreferenciados conta os locais com coordenadas; não alocados inclui
  locais sem coordenadas e pontos ainda sem vínculo. Não são complementos.
- Resumo municipal reconcilia cada contagem com TODOS os locais, inclusive os
  não alocados. Cobertura pondera aptos, não quantidade de pontos ou de seções.
- Grupos têm IDs únicos e listas sem duplicatas; referências desconhecidas,
  repetidas em grupos ou incompatíveis com o grupo do local são recusadas.
  Cada local alocado aparece exatamente uma vez nas agregações. Contagens e
  total de seções de cada grupo precisam coincidir com seus locais.
- validarVinculoTse confere o município carregado e a ponte real entre cada
  setor e id_agregacao em municipio.bairros. Grupo ausente do Censo é erro.

**Integridade referencial não prova contenção espacial.** Uma partição disjunta
de códigos não garante polígonos sem sobreposição, nem resolve pontos em bordas,
falhas de geocodificação, CRS ou mudanças de limites. Um produtor espacial real
precisa da malha auditada da mesma edição e de uma política explícita para
pontos em limites/ambíguos/fora da malha. Conservar esses locais como não alocados
com diagnóstico externo quando não houver vínculo seguro; nunca escolher o
primeiro polígono nem usar nm_bairro_tse como chave. Veja [GEOMETRIES.md do ETL](../etl_pipeline/GEOMETRIES.md).

## Comportamento da interface

A opção “Exibir locais de votação (TSE)” aparece após abrir um município.
Desativada por padrão, não faz requisições eleitorais na carga nacional/estadual.
Ativada, React Query usa o mesmo DataLoader com cache, validação e AbortSignal.
404 significa indisponibilidade; HTTP 503, JSON inválido ou falhas de integridade
são erros visíveis. Fetch usa Accept: application/json para evitar fallback HTML
em caminhos JSON ausentes. Trocar o território impede publicação de dados antigos.

MapViewport mantém uma fonte adicional de pontos com promoteId=id_local e uma
camada circle acima dos polígonos. Só locais com coordenadas viram features;
nenhum centroide é fabricado. Pontos cinza ainda não têm alocação, ciano indica
alocação declarada e contorno rosa destaca pontos do grupo selecionado. Hover
mostra ID/nome, aptos e votos válidos. O hover/click de pontos não seleciona o
polígono por baixo. A pintura socioeconômica permanece independente.

TsePanel mostra período/cargo, aviso_metodologico, contabilidade e cobertura.
Selecionar bairro cruza por id_agregacao e exibe apenas os locais desse grupo.
Grupo sem registro eleitoral exibe ausência, sem inferir zero. Votos por local
contido no perímetro não representam residência dos eleitores nem distribuição
uniforme de votos pela área. Seções eleitorais também não são setores IBGE.

## Validação

Na pasta frontend: npm test, npm run build e npm run test:e2e. As suítes verificam
reconciliação, arredondamento, referências, proveniência, georreferenciado sem alocação,
pontos sem coordenadas, carga opcional, cache, 404/503 e limpeza ao trocar UF.
O teste de navegador intercepta um sidecar SINTÉTICO, renderiza/inspeciona o ponto
e seleciona o agrupamento sem nova requisição. Não baixa dados reais do TSE.
