# Interface territorial

React + Vite + TypeScript estrito. Usa os JSONs existentes e valida respostas
com Zod; não inventa valores nem geometrias. Node >= 22.12 (validado em Node 24).

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

## Geometria ainda não disponível

A visão inicial é um **cartograma esquemático de UFs**, rotulado na interface.
Municípios/bairros aparecem em cartões tabulares. Não há polígonos ou zoom
geográfico real; selecionar região recorta o cartograma. Não atribuir os
retângulos a limites oficiais nem inferir bairros a partir deles.

`buildSectorToGroupMap(bairros)` e `groupForSectorFeature(properties, reverse)`
preparam o join para uma futura malha municipal de setores. CD_SETOR deve ser
string canônica, inclusive sufixos. A mesma malha atende bairro oficial e
fallback: cada setor herda a seleção/cor de seu id_agregacao. Features sem
correspondência ficam sem grupo; associações duplicadas e códigos numéricos
são recusados. O renderer futuro pode usar feature-state no MapLibre ou SVG,
sem dissolve no cliente. O carregamento de geometria deve permanecer lazy
por UF/município, com origem e release compatíveis com os dados tabulares.
