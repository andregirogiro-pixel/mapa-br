# Interface territorial

React + Vite + TypeScript estrito. Usa os JSONs existentes e valida respostas
com Zod; inclui uma malha sintética explicitamente identificada. Node >= 22.12 (validado em Node 24).

```bash
cd frontend
npm ci
npm run dev
```

Não é necessário gerar novamente os JSONs demonstrativos versionados. O plugin
Vite serve os arquivos de `../data/processed` sob `data/processed/`. No build,
copia essa árvore para dist, preservando as partições: nenhum detalhe municipal
é importado no bundle da aplicação ou buscado na carga inicial.

```bash
npm test
npm run build
npm run test:e2e
```

Os testes de navegador usam Chromium do sistema quando disponível. Se necessário,
instale um navegador de teste com `npx playwright install chromium`, ou indique
seu executável por `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. O Playwright inicia e
encerra seu próprio servidor de preview; execute o build antes. As capturas de
desktop/celular dos testes são gravadas em /tmp, não versionadas.

## Configuração dos dados e publicação

Por padrão, usa as fixtures. Para um recorte real já gerado pelo pipeline:

```bash
MAPA_BR_DATA_DIR=../data/processed_real npm run dev
MAPA_BR_DATA_DIR=../data/processed_real npm run build
```

O diretório é relativo a frontend/ (também aceita caminho absoluto). O mesmo
endereço público continua sendo data/processed; não é necessário reescrever
os caminhos dos JSONs. Depois de alterar o conjunto, recarregue a página para
descartar o cache da sessão. Não misture arquivos de releases distintas.

`VITE_DATA_URL` pode apontar para outro índice absoluto/relativo, servido com
CORS apropriado. `VITE_BASE_PATH=/observatorio/` configura implantação em
subdiretório; mantenha o mesmo valor em dev, build e preview. Publique dist/
inteiro sob esse prefixo, incluindo a pasta data/. Query params não precisam
de rewrite de rotas; carregam sempre o mesmo index.html.

## Contrato e navegação

- `src/types/contract.ts`: schema de 19 campos obrigatório, aliases textuais
  para IDs e null explícito. O exemplo anterior com propriedades opcionais foi
  alinhado ao motor Python atual, que exige todas as chaves. Não usar Number,
  parseInt ou coerção para IDs. Textos decimais exatos só são exibidos, sem
  conversão em float; cálculos visuais usam as projeções numéricas do contrato.
- `src/services/dataLoader.ts`: cada arquivo carrega seus descendentes com
  `new URL(arquivo, parentFileUrl)`. O detalhe municipal é resolvido contra a
  URL de uf/42.json, nunca contra a raiz. O cache guarda Promises por URL e
  compartilha pendências; abortar um consumidor não cancela outro. O transporte
  é abortado quando o último consumidor sai. Falhas são removidas do cache.
  A interface também impede publicação de respostas de navegações canceladas.
- `src/state/navigation.ts`: união discriminada dos cinco níveis, representada
  nos query params. Trocar UF cria um estado novo, sem município/bairro antigos.
  Links profundos e voltar/avançar funcionam; identificadores inválidos ou fora
  do recorte geram mensagens, sem selecionar arbitrariamente outro município.
- Nível 5: key e seleção sempre usam id_agregacao, inclusive no fallback com
  cd_bairro null. Origem da malha e alertas de sigilo permanecem explícitos.
- Renda sempre significa renda do responsável nesta visualização. Renda
  domiciliar é outro campo. Gini/PIB ausentes em bairros aparecem como “—”.
  A cobertura usa os pesos conhecidos para não exibir 100% quando o JSON
  arredondou uma fração suprimida; denominador sob sigilo continua desconhecido.

## MapLibre offline e geometrias de demonstração

As sete malhas pequenas em `public/geo/demo/` são versionadas: `ufs.geojson`,
`municipios/{35,42}.geojson` e `setores/{cd_uf}/{cd_mun}.geojson` dos quatro
municípios. São retângulos SINTÉTICOS para testar interação; não são limites
geográficos oficiais. As tabelas continuam como navegação acessível por teclado
ou alternativa quando WebGL não está disponível.

Para regenerar, na raiz do repositório:

```bash
python3 etl_pipeline/01_build_uf_base.py --date 2026-10-25
python3 etl_pipeline/build_demo_geometries.py
cd frontend
npm ci
npm run dev
```

As dependências precisam estar instaladas (npm ci requer rede ou cache local).
Depois, a execução e o build da demo não acessam IBGE, CDNs, tiles, fontes ou
sprites remotos. O estilo MapLibre é local, sem mapa-base externo; o worker está
no pacote instalado. A auditoria de renda de 2022 não é executada pelo frontend
nem condiciona a demonstração. As malhas já versionadas permitem iniciar sem
Python e sem regenerar as fixtures.

O mapa carrega UFs inicialmente, municípios somente ao abrir SP/SC e setores
apenas ao abrir o município. Região filtra/ajusta a câmera às UFs correspondentes.
UFs sem detalhe conservam seu resumo e polígono sintético sem fetch municipal.
`promoteId` usa cd_uf, cd_mun ou cd_setor textual. `setFeatureState` atualiza cor,
sigilo, cobertura e seleção. A seleção de bairro usa SEMPRE id_agregacao e
acende todos os seus setores pelo join reverso, inclusive no fallback; não há
dissolve no navegador. Contorno âmbar indica grupo com setores sob sigilo,
contorno rosa indica o grupo selecionado. Tooltip mostra cobertura conhecida
ou desconhecida; valores ausentes não viram zero.

`demoGeometry.ts` recusa códigos numéricos, duplicatas, setores fora do município,
grupos incoerentes e inventários diferentes dos dados tabulares. Geometrias são
permitidas somente para metadata.tipo_dados=simulados. O manifesto conserva
hashes locais dos arquivos tabulares para rastreabilidade; o cliente verifica
os vínculos/IDs, não revalida esses hashes. Não apontar dados reais para geo/demo.
Veja [a política de geometrias oficiais](../etl_pipeline/GEOMETRIES.md).

## Store geográfica compartilhada

`src/store/useGeoStore.ts` usa Zustand com `GeoStoreProvider` (já instalado em
App). `useGeoStore(selector)` compartilha ações e a métrica entre componentes.
`createGeoStore()` permite testes sem React. A navegação permanece um único
campo `navigation` discriminado, sem combinação de nível com IDs descendentes
incompatíveis em campos paralelos.

Ações: irParaPais, selecionarRegiao, selecionarUf, selecionarMunicipio,
selecionarBairro, voltarNivel e setMetrica. As ações validam os valores originais
antes de serializar na URL; não aplicam String(code). Registrar as associações
UF/região do índice permite voltar à região correta mesmo após trocar de UF.
O provider acompanha popstate e inicializa links profundos na montagem. A
métrica persiste ao navegar e voltar; não é gravada nos query params.

Métricas disponíveis: população, renda do responsável, PIB per capita, PIB
em bilhões, cobertura de renda e quantidade de setores sob sigilo. A interface
contém o botão Voltar nível, independente do histórico voltar/avançar do navegador.

Os nomes IndicadoresCanonica, BairroAgregado, RegiaoResumo, UfIndiceItem,
MunicipioResumoItem e MunicipioDetalhe são exportados como aliases dos schemas
Zod, preservando uma única definição. total_bairros e total_setores nos resumos
municipais são inteiros obrigatórios, como gerados pelo Python.

As 25 UFs sem detalhe da demo (incluindo Amazonas) continuam mostrando resumo;
a carga exige dados_disponiveis true e arquivo preenchido. O Vite já serve a
árvore local sem duplicação no desenvolvimento; não é necessário criar symlink.

## Componentes e métricas

- `lib/geoStats.ts` centraliza o catálogo, a disponibilidade por nível,
  formatação pt-BR, quantis interpolados (R-7) e bounding boxes, inclusive de
  coleções de geometrias. Valores ausentes não viram zero ou sigilo; cobertura
  conhecida parcial não arredonda para um falso 100%.
- `MapViewport.tsx` mantém uma instância WebGL com três fontes locais
  (ufs-source, municipios-source, setores-source). Mantém IDs textuais e limpa
  feature-state ao trocar o recorte. Mudança de métrica atualiza cores sem
  refazer fetch; selecionar grupo ajusta a câmera e destaca seus setores.
- PIB continua selecionado na store ao entrar num município, mas a pintura e
  o ranking de bairros usam renda do responsável, com aviso e legenda explícitos.
  O KPI municipal de PIB continua válido; no bairro, PIB segue indisponível.
  Voltar à UF retoma a pintura de PIB. O fallback não imputa renda ausente.
- `AnalyticalSidebar.tsx` apresenta KPIs, ranking, dispersão e auditoria de
  responsáveis, pesos, setores por média/massa e strings decimais exatas.
  Universo suprimido é identificado como parcial, sem inventar totais.
- `App.tsx` usa React Query por aplicação para índice e recorte selecionado,
  delegando a cadeia índice → UF → município ao DataLoader validado. staleTime
  e gcTime são Infinity durante a sessão, retry=1, sem refetch no foco. Os sinais
  cancelam navegações antigas; networkMode=always permite servir localhost
  mesmo quando navigator.onLine=false. Não há symlink nem segundo data loader.

Após atualizar dependências: `npm ci`, `npm run dev`. Para regenerar fixtures e
geometrias, execute os dois geradores Python na raiz; os caminhos Vite existentes
já servem a árvore particionada e funcionam em subdiretórios de publicação.

## Sidecar eleitoral opcional

O [contrato TSE](TSE_SIDECAR.md) usa `types/tseContract.ts`, sem modificar os
schemas socioeconômicos. A opção TSE aparece no município; nenhum arquivo
TSE é solicitado inicialmente. O payload opcional fica na mesma árvore em
`tse/{cd_uf}/{cd_mun}.json`. O middleware e o build preservam essa partição.

Há validação cruzada de votos, proporções, locais, seções, cobertura ponderada,
ponte setor/grupo e proveniência. A camada circle usa pontos, mantendo os
indicadores do Censo nos polígonos. O painel seleciona o agregado do bairro por
id_agregacao e mostra o aviso do recorte eleitoral. Ausência de sidecar retorna
indisponibilidade, não votos zero. Não há ingestão TSE real neste passo; dados
sintéticos eleitorais existem apenas nos testes. O produtor Python futuro deverá
usar Decimal/ROUND_HALF_EVEN e demonstrar contenção na malha compatível.
