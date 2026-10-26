# Download e staging do Censo 2022

`03_fetch_ibge_raw.py` prepara fontes locais para `02_ingest_ibge_real.py` com
biblioteca padrão. O destino padrão é `data/processed_real`, preservando a demo.

## Estado da validação

A execução com a publicação oficial de 2022 **ainda não foi validada**. O proxy
do ambiente negou as requisições aos três hosts do IBGE com 403. Nenhum dado
2010 foi utilizado para simular uma publicação de 2022. O template de fontes
não é executável sem preencher URLs e colunas conferidas no dicionário oficial.
Não há promessa de download em 20 segundos nem de contagem de municípios/setores
sem conferir o inventário da edição efetivamente utilizada.

Foram acrescentados ao rascunho da rede, preservando os presets existentes:
`ftp.ibge.gov.br`, `apisidra.ibge.gov.br`, `servicodados.ibge.gov.br`.
Revisar/salvar e publicar o ambiente aplica a configuração; salvar o rascunho
sozinho não libera a execução corrente. TLS, proxy e verificação de certificados
permanecem habilitados. Não contornar a política com proxies alternativos.

## Dois manifestos, duas responsabilidades

1. `manifests/ibge_padrao.json` descreve os nomes das colunas já preparadas,
   UTF-8, delimitador ponto e vírgula, decimal ponto. É compatível com a dataclass
   IBGEReleaseManifest. Não é um dicionário dos arquivos brutos. O script 03
   ajusta esse manifesto ao perfil selecionado, incluindo release, universo,
   ano do PIB e presença de média/massa. Não duplica regras do core/02.
2. Copiar `manifests/ibge_2022_sources.template.json` para um perfil de fonte e
   preencher após ler a documentação oficial. Os placeholders falham de forma
   explícita, em vez de adivinhar URLs ou códigos V0001/V005. Remover mapeamentos
   opcionais ausentes, como nomes de bairro, quando a publicação não os oferecer.

Campos do perfil de fonte:

- release_censo: identificação exata da edição; periodo_censo deve ser 2022.
- dictionary_url: referência HTTPS oficial do dicionário; universo_renda deve
  identificar o denominador exato e a inclusão/exclusão de responsáveis sem renda.
- domicilios_universo: total_fisico. Não aceitar DPPO/particulares como total
  físico de todos os domicílios. Se a fonte não fornece o total, é necessária
  outra tabela ou uma revisão explícita de contrato; nunca rebatizar V001.
- tables[]: name, periodo, scope (uf/national), encoding, delimiter,
  decimal_separator, member_pattern e columns (campo interno → coluna bruta).
  Toda tabela mapeia cd_setor. Os demais campos não podem ser definidos por duas
  tabelas; a chave de setor é o único campo de join compartilhado no perfil.
- Cada tabela tem urls, ou directory_url + archive_pattern. URLs e padrões de
  fontes por UF podem usar {uf}/{sigla}. O diretório é lido por HTMLParser e os
  links de ZIP são resolvidos com urljoin, sem recorrer ao FTP de 2010.
- Uma fonte national é baixada/lida uma vez por tabela e filtrada pelas UFs;
  seu member_pattern deve abranger todas as UFs sem placeholders territoriais.
- Encoding é declarado e estrito: não usar errors=ignore/replace nem fallback
  silencioso latin-1/cp1252. Nomes de colunas também precisam coincidir exatamente.

As URLs devem ser HTTPS em domínio IBGE. O perfil declara o dicionário, mas o
script não interpreta PDF nem certifica que uma coluna foi corretamente escolhida.
A revisão do mapeamento e das unidades ainda é responsabilidade da preparação
científica da fonte. Não misturar arquivos/renda de 2010 com população de 2022.

## Execução após conferir as fontes e liberar a rede

```bash
python3 etl_pipeline/03_fetch_ibge_raw.py \
  --source-profile /caminho/perfil-2022-verificado.json \
  --ufs SC \
  --pib-year 2021 \
  --output-dir data/processed_real
```

Usar `--ufs SC SP` ou `--ufs ALL` para outros recortes. `--stage-only` gera
CSVs/manifesto/relatório e não chama o motor. `--no-download-geojson` desativa
malhas; a opção é reversível via BooleanOptionalAction. `--geo-dir` escolhe o
destino das malhas e `--mesh-period` registra explicitamente o período solicitado.
O diretório de saída JSON deve ser novo/vazio; o comando sugerido anteriormente
com `--output-dir data/processed` é recusado para preservar as fixtures existentes.

O PIB usa SIDRA tabela 5938, variável 37, ANO EXPLÍCITO. Não usa last 1 rotulado
como 2021. Cabeçalho define as posições das dimensões; município, ano, variável
e unidade Mil Reais são conferidos. Extras do PIB são filtrados pelo conjunto
municipal do Censo e listados no relatório. Município censitário sem PIB aborta:
não se usa interseção para apagar silenciosamente seus setores.

PIB e população de anos distintos são declarados nos metadados. Comparabilidade
territorial também exige revisar mudanças de limites/códigos municipais, além
de a coincidência das chaves não provar completude do inventário censitário.

## Qualidade, relatórios e recursos

- Join 1:1 entre todas as tabelas selecionadas, por CD_SETOR textual, em SQLite
  temporário. Duplicatas e ausência de linhas em qualquer tabela são erros.
  Arquivos nacionais não são montados em uma lista Python de setores.
- Staging por execução em `data/raw/staging/run-*/`: setores_staged.csv,
  pib_staged.csv, manifest_ibge.json, report.json e invalid_sectors.csv.
  Manifesto só é publicado quando o staging está pronto. Não reutilizar arquivos
  soltos de uma execução failed; report.json identifica o estado do lote.
- Sigilo em população/domicílios, situação desconhecida (incluindo 9) ou
  responsáveis excedendo universos: relatório e bloqueio da publicação.
  Não converter desconhecidos para zero, situação para rural, nem usar min/max
  para alterar população ou peso. Nenhum setor inválido é excluído silenciosamente.
- O relatório contém no máximo 20 exemplos de erros em memória; a lista completa
  de setores problemáticos fica em CSV. Conflitos de nomes são normalizados
  somente por NFC, caixa e espaços; São/Sao ou mojibake não são fundidos.
- Renda zero é válida. X e ausências permanecem distintos. A massa reconstruída
  a partir da média herda o arredondamento da média: aritmética Decimal exata
  não recupera a massa original desconhecida. Massa/média têm a mesma política
  de compatibilidade e status do 02; não ampliar tolerâncias para contorná-la.
- Cache em data/raw/cache, por URL, com recibos de tamanho, SHA-256 LOCAL e URL
  final. Isso detecta corrupção local, não substitui checksum assinado oficial.
  Downloads são gravados em temporário e renomeados só após conclusão.
  Cache inconsistente falha, sem reutilizar artefato suspeito. Limites: 2 GiB por
  download geral, 4 GiB por membro CSV descompactado; requer espaço em disco.
- Proveniência compacta entra nos metadados durante a escrita do 02, sem
  reserializar todos os JSONs. O índice nacional não recebe listas de municípios
  do relatório nem listas de setores. Relatório completo fica no staging.

## Geometrias

A API de Malhas v3 é chamada para país, regiões, UFs e municípios por UF. JSONs
são validados como FeatureCollection poligonal antes de serem gravados em
frontend/public/geo. sources.json conserva URLs, digests e período solicitado.
Não se considera automaticamente provada a compatibilidade com os setores de
2022. Esses endpoints/períodos ainda dependem de validação online.

Esse passo **não** baixa malha de setores nem dissolve bairros. A camada de nível
5 continua exigindo uma malha setorial da mesma edição, a ser verificada. O
frontend atual mantém cartograma/cartões e o join reverso pronto; não passa a
renderizar polígonos só porque os arquivos foram baixados. Dados brutos, saídas
reais e malhas pesadas permanecem ignorados pelo Git.

## Testes

```bash
.venv/bin/python -m unittest discover -s etl_pipeline/tests -v
```

A suíte do 03 usa ZIPs/CSVs pequenos e respostas SIDRA/GeoJSON sintéticas, além
de simular transporte HTTP para verificar cache/TLS padrão e rejeição de download
incompleto. A validação online da fonte oficial é uma etapa separada e pendente.
