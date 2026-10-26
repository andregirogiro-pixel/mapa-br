# mapa-br

Base de uma plataforma analítica do Brasil: País → Região → UF → Município →
Bairro/Setor. Há um frontend React + Vite com navegação dos cinco níveis,
mapa MapLibre com polígonos sintéticos, painel analítico e geradores offline de demonstração.
A API e a renderização de geometrias reais continuam pendentes. O automatizador
03 prepara o download por perfil explícito. Fontes oficiais de 2022 já foram
baixadas e auditadas para SC; a consolidação da renda continua bloqueada por
incompatibilidade do peso proposto com a média publicada.
O adaptador `02_ingest_ibge_real.py` processa arquivos locais via manifesto explícito.

## Gerar e testar

Python 3.11+, sem dependências externas para estes comandos:

```bash
python3 etl_pipeline/01_build_uf_base.py --date 2026-10-25
python3 -m unittest discover -s etl_pipeline/tests -p test_build_uf_base.py -v
```

Sem `--date`, usa data UTC. `--output-dir /tmp/mapa-br-demo` escolhe outro destino.

```text
data/processed/
  brasil.json                       # país, cinco regiões e 27 UFs
  uf/35.json                        # resumos municipais de SP
  uf/42.json                        # resumos municipais de SC
  municipios/35/3550308.json         # São Paulo: indicadores e bairros
  municipios/35/3509502.json         # Campinas
  municipios/42/4205407.json         # Florianópolis
  municipios/42/4209102.json         # Joinville
```

**Todos os indicadores são simulados.** Só nomes/códigos de região, UF e município
correspondem à divisão oficial. Códigos de bairros/setores são fixtures de formato,
sem vínculo oficial verificado. SP/SC reconciliam os totais de seus municípios
e bairros demonstrativos; as outras 25 UFs têm apenas resumos sintéticos.

## Contrato 2.0 e carregamento sob demanda

O índice nacional aponta para `uf/{cd_uf}.json`, apenas para SP/SC nesta demo.
Esses arquivos têm `municipios_resumo`, sem bairros ou arrays de setores. Cada
município aponta para seu detalhe, usando caminho relativo ao próprio arquivo
UF (ex.: `../municipios/42/4205407.json`). O consumidor deve resolver os caminhos
em relação ao JSON que os contém. Não concatenar todos com a URL da raiz.
Somente o detalhe municipal contém `bairros` e `cd_setores`.

Migração do 1.1: `municipios` com bairros embutidos saiu do arquivo de UF;
passou a `municipios_resumo` + arquivo de detalhe com objeto `municipio`.
O caminho canônico continua `uf/42.json`, não `42_SC.json`.
O frontend atual já consome esse contrato particionado.

Todos os níveis mantêm nomes explícitos: `renda_media_domiciliar` e
`renda_media_responsavel`. A chave ambígua `renda_media` foi removida.
Municípios incluem PIB em mil reais, bilhões derivados e per capita.
PIB e renda domiciliar dos bairros ficam nulos; não são inferidos da renda
exclusiva dos responsáveis. País/região também não calculam renda sem pesos.

Bairros oficiais e fallback usam a mesma agregação e o mesmo schema. Códigos
ficam como strings; a entrada normaliza espaços e caixa dos sufixos. O fallback
não fabrica código de bairro. IDs oficiais são `bairro:{cd_bairro}`; fallback
usa `subdist:{cd_subdist}:{urbano|rural}`. Os setores precisam de vínculo territorial validado.

Renda usa `responsaveis_renda`, nunca o total físico `domicilios`. O peso não
pode exceder população nem domicílios. Massa de rendimento prevalece sobre média,
mas a presença de ambas exige diferença de até R$ 0,05 entre massa/peso e média.
Essa tolerância não substitui a confirmação do universo no dicionário da fonte.
A renda suprimida fica fora de ambos os termos da média, com cobertura e contagens
publicadas. `None` não é automaticamente sigilo. Arredondamento final:
Decimal/ROUND_HALF_EVEN. Gini não é estimado pela média de Ginis.

PIB canônico: `pib_mil_reais` inteiro nas fixtures; bilhões são derivados. Fontes
com frações são suportadas no adaptador por `pib_mil_reais_exato` (texto decimal),
fonte canônica dos rollups. Os campos numéricos são projeções para a interface.
Release e mapeamentos continuam nulos na demo; no adaptador vêm do manifesto.
O perfil de sufixos e as nomenclaturas ainda precisam ser verificados na fonte escolhida.

Cada JSON é validado sem serialização e gravado uma vez, com troca atômica por
arquivo. O gerador mantém um detalhe municipal por vez, sem montar um lote
nacional de bairros/setores em memória. Veja [AGENTS.md](AGENTS.md) para detalhes.

## Diretórios e dependências futuras

`frontend/` contém React + Vite + TypeScript; `notebooks/` reserva exploração; `data/raw/`
contém bases locais ignoradas pelo Git.

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r etl_pipeline/requirements.txt
```

Os requisitos incluem pyarrow para Parquet e não são um lockfile. Para a suíte
completa, incluindo Parquet, após instalar as dependências:

```bash
.venv/bin/python -m unittest discover -s etl_pipeline/tests -v
```

Para rodar apenas os testes da demo sem dependências externas:

```bash
python3 -m unittest discover -s etl_pipeline/tests -p test_build_uf_base.py -v
```

## Ingestão local parametrizada

`core_contract.py` contém o único motor de validação/agregação usado por 01 e 02.
Preencha uma cópia de `etl_pipeline/manifests/template.json` a partir do dicionário
da release. O template não é um mapeamento oficial. Consulte
[o contrato de adaptação](etl_pipeline/manifests/README.md).

```bash
.venv/bin/python etl_pipeline/02_ingest_ibge_real.py \
  --manifest /caminho/manifesto.json \
  --setores /caminho/setores.csv \
  --pib /caminho/pib.csv \
  --output-dir data/processed_real
```

CSV preserva códigos como texto; Parquet com código numérico aborta antes da
leitura. A renda usa Decimal e distingue sigilo de ausência. Dados territoriais,
demográficos e de renda devem chegar consolidados por setor. O adaptador não
baixa bases nem confirma automaticamente o dicionário ou a completude da malha.

Bairros oficiais e fallback por subdistrito + urbano/rural coexistem. Totais são
reconciliados por município; PIB, população e renda são agregados bottom-up.
A massa parcial divulgada fica em `massa_rendimento_considerada` como texto decimal.
Se o denominador foi suprimido, a cobertura fica null e os setores desconhecidos
são contados. Não interpretar a soma conhecida como universo completo.

O staging usa SQLite temporário em disco; somente um município de setores fica
em memória. Saídas reais ficam separadas da demo, com os mesmos caminhos de
carregamento progressivo. Use destino novo/vazio por release. Fora do recorte,
os resumos ficam null; o resumo nacional representa o recorte fornecido.
PIB per capita usa população do Censo e informa ambos os períodos nos metadados.

## Contrato único para frontend e ingestão

Os blocos de indicadores têm as mesmas 19 chaves em ambos os geradores e nos
níveis município, UF, região e país. O validador rejeita chaves faltantes/extras.
As fixtures agora preenchem renda do responsável, cobertura, domicílios e
contagens a partir dos próprios setores; SP/SC são agregados dos municípios.
Para as outras 25 UFs, só há resumos de setores internos totalmente sintéticos,
sem exportar identificadores ou detalhes municipais. Gini e renda domiciliar
sem base adequada ficam null. `INDICATOR_KEYS` é a referência em core_contract.py.

O adaptador exige status iguais quando média e massa estão ambas mapeadas.
Parquet monetário aceita somente texto/decimal128/256: float, inclusive NaN,
é rejeitado, sem arredondamento automático. O separador de texto Parquet é
`parquet_decimal_separator` (padrão ponto), independente do CSV.

A carga SQLite usa validação leve por setor; não constrói um agregado descartável
para cada linha. A tolerância massa/média permanece R$ 0,05. PIB total permanece
não negativo; componentes econômicos assinados exigiriam métricas separadas.

## Executar a interface

Requer Node >=22.12 (validado com Node 24):

```bash
cd frontend
npm ci
npm run dev
```

As fixtures versionadas são servidas automaticamente, sem API ou novos downloads
de bases. A interface tem tema escuro, layout dividido, rankings, dispersão,
indicadores e qualidade da renda. URLs preservam os cinco níveis de navegação.

```bash
npm test
npm run build
npm run test:e2e
```

O último comando requer Chromium; veja [frontend/README.md](frontend/README.md)
para instalar o navegador de testes ou selecionar seu executável. O build inclui
os JSONs separados em dist/data/processed. As requisições continuam lazy.

A demonstração inclui sete GeoJSONs sintéticos locais, identificados na tela.
MapLibre carrega UFs, municípios e setores sob demanda, aplica feature-state e
seleciona bairros/grupos via join reverso. Não usa tiles, fontes ou serviços IBGE
remotos. Os botões continuam disponíveis para navegação por teclado.

Para regenerar as malhas (opcional, já versionadas):

```bash
python3 etl_pipeline/build_demo_geometries.py
```

Após instalar as dependências com npm ci, a execução/build da demo funciona
sem internet. A auditoria de renda blocked não bloqueia a demonstração.
Malhas oficiais futuras virão exclusivamente de arquivos estáticos FTP,
com [auditoria espacial e temporal](etl_pipeline/GEOMETRIES.md).

A store geográfica compartilhada (Zustand) mantém a navegação discriminada,
a métrica e a sincronização com a URL. O botão Voltar nível usa os vínculos
UF/região do índice. PIB em bilhões e setores sob sigilo também podem colorir
a visualização. As UFs sem detalhe, como Amazonas na demo, mantêm o resumo
sem solicitar arquivos ausentes. O desenvolvimento já serve data/processed
via Vite; não exige symlink nem cópia para frontend/public.

## Download e staging 2022

O manifesto de colunas preparadas está em etl_pipeline/manifests/ibge_padrao.json.
O novo 03_fetch_ibge_raw.py faz download/cache, join das tabelas e filtragem do
PIB sem relaxar as invariantes. Ele exige um perfil de fontes/colunas de 2022
conferido no dicionário. O template não contém URLs ou códigos brutos verificados.

```bash
python3 etl_pipeline/03_fetch_ibge_raw.py \
  --source-profile /caminho/perfil-2022-verificado.json \
  --ufs SC --pib-year 2021 --output-dir data/processed_real
```

Use --stage-only para revisar o staging antes da ingestão. O 03 é exclusivamente
tabular; não baixa geometrias nem chama a API de Malhas. O destino deve estar vazio; as fixtures são preservadas.
Sigilo e erros não viram zeros ou ajustes artificiais. Diferenças substantivas
em nomes e municípios censitários sem PIB interrompem o processo com relatório.
Na nova tentativa, FTP e SIDRA responderam com sucesso. O recorte básico de SC
tem 295 municípios e 16.736 setores; a tabela de renda tem 16.435 setores.
V06001 não pode ser assumido como peso de V06004: a média é dos responsáveis
**com rendimentos**, e a ponderação proposta diverge do agregado municipal oficial.
A API de malhas retornou 503. Nenhuma release JSON real foi publicada.

Para reproduzir a verificação, sem alterar as fixtures:

```bash
python3 etl_pipeline/audits/verify_2022_sc.py
```

Leia [a auditoria das fontes de 2022](etl_pipeline/IBGE_2022_AUDIT.md) e
[o guia de execução e limitações](etl_pipeline/FETCHING_IBGE.md).

## Componentes analíticos e métricas de mapa

`frontend/src/lib/geoStats.ts` centraliza catálogo, quantis reais e formatação.
`MapViewport` mantém três fontes GeoJSON com IDs textuais em uma instância WebGL;
`AnalyticalSidebar` apresenta os indicadores e auditoria dos pesos/decimais.
React Query coordena a carga validada e cancelável do DataLoader existente.

Ao escolher PIB e entrar na visão de bairros/setores de um município, a pintura
usa renda do responsável com aviso e legenda próprios. O seletor mantém PIB e
volta a usá-lo ao retornar à UF. PIB dos bairros continua null. UFs sem detalhe
continuam acessíveis por seus resumos, sem requisições municipais inexistentes.
O Vite serve tudo localmente: não criar symlink em frontend/public/data.

## Sidecar TSE

O [contrato eleitoral municipal](frontend/TSE_SIDECAR.md) fica separado do Censo
em `tse/{cd_uf}/{cd_mun}.json`. A interface tem carga opcional, pontos de locais
de votação e painel cruzado por id_agregacao. Valida votos, cobertura ponderada
pelos aptos, referências e proveniência. Não altera os indicadores socioeconômicos.
Ainda não há ingestão/geocodificação real TSE; as fixtures eleitorais são de testes.
