# Auditoria online do Censo 2022 — Santa Catarina

Verificação em 2026-10-26. FTP e SIDRA responderam com sucesso nesta tentativa.
Os dados oficiais foram baixados para `data/raw/cache`, com recibos de URL,
tamanho e SHA-256 local. Os hashes detectam alteração/corrupção local; não são
assinaturas do IBGE. Os arquivos pesados permanecem fora do Git.

**Resultado: download concluído; publicação JSON real bloqueada.** O denominador
necessário para agregar a média de renda não foi identificado nas fontes
conferidas. As fixtures continuam em `data/processed`.

## Fontes fixadas

| Fonte | Arquivo oficial |
| --- | --- |
| Básico setorial | [Agregados_por_setores_basico_BR_20260520.zip](https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/Agregados_por_Setores_Censitarios/Agregados_por_Setor_csv/Agregados_por_setores_basico_BR_20260520.zip) |
| Dicionário geral | [dicionario_de_dados_agregados_por_setores_censitarios_20260520.xlsx](https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/Agregados_por_Setores_Censitarios/dicionario_de_dados_agregados_por_setores_censitarios_20260520.xlsx) |
| Renda setorial | [Agregados_por_setores_renda_responsavel_BR_20260508_csv.zip](https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/Agregados_por_Setores_Censitarios_Rendimento_do_Responsavel/Agregados_por_setores_renda_responsavel_BR_20260508_csv.zip) |
| Renda municipal | [Agregados_por_municipios_renda_responsavel_BR_20260508_csv.zip](https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/Agregados_por_Setores_Censitarios_Rendimento_do_Responsavel/Agregados_por_municipios_renda_responsavel_BR_20260508_csv.zip) |
| Dicionário de renda | [dicionario_de_dados_renda_responsavel_20260508.xlsx](https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/Agregados_por_Setores_Censitarios_Rendimento_do_Responsavel/dicionario_de_dados_renda_responsavel_20260508.xlsx) |
| PIB municipal 2021 | [SIDRA, tabela 5938, variável 37, municípios de SC](https://apisidra.ibge.gov.br/values/t/5938/n6/in%20n3%2042/v/37/p/2021?formato=json) |

As datas nos nomes identificam revisões dos arquivos, não o ano do Censo. Os
dados censitários são de 2022. O PIB foi solicitado explicitamente para 2021.
O catálogo [ibge_2022_sources.audit.json](manifests/ibge_2022_sources.audit.json)
registra recibos e resultados compactos; não pode ser usado em `--source-profile`.

## Campos observados e inventários

| Arquivo/campo | Significado no dicionário ou cabeçalho conferido |
| --- | --- |
| Básico, `v0001` | Total de pessoas |
| Básico, `v0002` | Total de domicílios: DPPO + DPPV + DPPUO + DPIO + DCCM + DCSM |
| Básico, `CD_SIT` | Código de situação; a coluna `SITUACAO` contém o texto |
| Renda, `V06001` | Pessoas responsáveis em domicílios particulares permanentes ocupados |
| Renda, `V06004` | Valor do rendimento nominal médio mensal das pessoas responsáveis **com rendimentos** por domicílios particulares permanentes ocupados |

Os cabeçalhos do básico usam `v0001`/`v0002` minúsculos; renda usa `V06001` etc.
O básico foi lido integralmente com `cp1252`, delimitador `;`, sem substituição de
caracteres. A renda setorial foi lida com `utf-8-sig`, delimitador `;` e decimal
ponto; a renda municipal usa decimal vírgula e foi lida com `cp1252`.

No recorte de SC do básico:

- 295 municípios, 16.736 códigos setoriais únicos, todos textuais de 15 dígitos;
- 7.610.361 pessoas e 3.475.161 domicílios físicos;
- 6.645 setores têm `CD_BAIRRO` igual ao ponto literal `.`;
- 38 setores têm `CD_SIT = "9"` e `SITUACAO` vazia; suas populações e domicílios
  são zero. Não foram reclassificados como rurais.

A renda tem 16.435 setores de SC, dos mesmos 295 municípios. Em 296 linhas,
as seis variáveis `V06001` a `V06006` são `X`. Não há setores exclusivos da renda.
Os 301 setores exclusivos do básico têm população zero, mas somam **230
domicílios físicos**. Um inner join perderia esses domicílios. Ausência da linha
não foi transformada em sigilo, renda zero ou denominador zero.

O PIB retornou os mesmos 295 códigos municipais, sem faltantes ou extras. Essa
reconciliação não comprova que os inventários setoriais de publicações diferentes
sejam equivalentes nem substitui a comparação com a malha oficial.

## Por que V06001 não foi usado como peso de V06004

O dicionário de renda contém seis variáveis: contagem de responsáveis, moradores,
variância de moradores, média de renda, variância de renda e mediana de renda.
Não apresenta explicitamente a contagem dos responsáveis **com rendimentos**,
nem massa de renda. O dicionário geral conferido também não oferece essa medida
de renda alternativa. Não se pode inferir que a contagem de todos os responsáveis
seja o denominador da média restrita aos responsáveis com rendimentos.

Foi feita uma verificação adicional com a renda municipal oficial da mesma
revisão. Foram elegíveis municípios em que todas as linhas publicadas de renda
setorial têm `V06001` e `V06004` divulgadas, a soma de `V06001` setorial coincide
exatamente com `V06001` municipal, e o peso total é positivo. Isso selecionou
178 municípios; os outros 117 tinham sigilo em alguma dessas variáveis.

Para cada município elegível, calculou-se:

```python
numerador = sum(Decimal(s["V06004"]) * Decimal(s["V06001"]) for s in setores)
peso = sum(Decimal(s["V06001"]) for s in setores)
media_candidata = numerador / peso
```

Os produtos e as somas são exatos em Decimal para esses dados; a divisão usa
precisão de 28 dígitos, sem arredondamento monetário intermediário. Todos os 178
municípios elegíveis divergiram em mais de R$ 0,05 da `V06004` municipal publicada.

| Município | Setores de renda | Soma V06001 = total municipal | Média candidata | V06004 municipal |
| --- | ---: | ---: | ---: | ---: |
| Lindóia do Sul (`4209854`) | 12 | 1.637 | R$ 3.911,70 | R$ 3.837,33 |
| Petrolândia (`4212700`) | 16 | 2.443 | R$ 4.537,68 | R$ 4.611,55 |

Em Lindóia do Sul, o numerador candidato é `6403455.68` e o peso é `1637`.
A divergência é cerca de R$ 74,37. Essa comparação não determina sozinha a causa
nem recupera o denominador correto; impede aceitar automaticamente o mapeamento
proposto. A seleção usa as linhas do CSV de renda, sem afirmar completude em
relação a uma malha setorial externa. Não ampliar tolerâncias para fazer os
resultados passarem.

## Reprodução e próximos requisitos

Na raiz do repositório, com Python 3.11+ e acesso HTTPS oficial:

```bash
python3 etl_pipeline/audits/verify_2022_sc.py
```

O utilitário reutiliza o download/cache do 03 e grava a auditoria completa em
`data/raw/verification_2022/`, incluindo comparações com Decimal e recibos.
Ele não chama a ingestão, não muda fixtures e não publica release JSON para a UI.
Código de saída zero significa auditoria concluída, não liberação estatística
da fonte. O relatório identifica a publicação como bloqueada.

Para concluir a ingestão com renda é preciso obter o denominador ou a massa do
mesmo universo da média, ou escolher uma medida alternativa documentada. Também
é necessário definir, por release, o tratamento do bairro ausente `.` e da
situação `9`, e preservar os setores sem linha de renda sem fabricar seus dados.
Essas decisões precisam manter os totais físicos e a distinção entre ausência,
sigilo e renda zero.

A API `servicodados.ibge.gov.br` retornou 503 com erro de conexão upstream nas
consultas de malhas, inclusive em consultas simples e documentação. Não foram
baixadas geometrias nem verificada compatibilidade temporal/espacial. O portal
`www.ibge.gov.br` retornou 403; as referências disponíveis aqui são os arquivos
efetivamente obtidos no FTP e no SIDRA.
