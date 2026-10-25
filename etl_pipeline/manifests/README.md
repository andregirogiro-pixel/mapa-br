# Manifestos de release

`template.json` é um molde com nomes fictícios de colunas, **não** um mapeamento
validado do IBGE. Faça uma cópia e preencha a partir do dicionário da publicação
exata. Os anos exemplificados também devem ser conferidos. Não use nomes V001/
V0001 por memória nem combine massa, média e denominador de universos distintos.

O adaptador recebe arquivos locais, já consolidados por setor. Se o IBGE publicar
território, demografia e renda em arquivos separados, faça antes o join 1:1 pela
chave textual verificada, sem substituir ausências por zero. Não há download,
join espacial ou consolidação automática entre arquivos brutos neste adaptador.

- `col_map_*` mapeia campo interno para nome exato da coluna; nomes obrigatórios
  não podem ser reutilizados. Todas as colunas declaradas precisam existir.
- Distrito/subdistrito e nomes, bairro, nome municipal e uma das medidas de
  renda podem ter mapeamento null/omitido se a fonte não os fornecer. Pelo menos
  média ou massa é obrigatória. Prefixos administrativos são extraídos do setor;
  se colunas explícitas tiverem dados, precisam coincidir. Códigos territoriais
  numéricos são sempre recusados. Para nome municipal ausente, usa-se o código
  como rótulo, sem inventar nome oficial.
- O perfil atual é 15 dígitos + sufixo A–Z opcional, com distrito nos primeiros
  9 e subdistrito nos primeiros 11 dígitos. Confirme esse perfil na malha escolhida;
  formatos diferentes exigem novo perfil no motor, não truncamento no adaptador.
- `situacao_setor`: 1–3/URB* → urbano; 4–8/RUR* → rural. Outros valores falham.
  Confira a classificação no dicionário da release antes de executar.
- `csv_encoding`, delimitador e separador decimal aplicam-se às duas fontes CSV.
  Converta separadamente arquivos com convenções incompatíveis. `utf-8-sig`
  trata BOM UTF-8; use cp1252 explicitamente quando essa for a codificação real.
- CSV usa DictReader sem inferência. Parquet usa pyarrow e valida o schema de
  todos os códigos mapeados e colunas CD_* antes da primeira linha, até em
  arquivos vazios. Códigos devem ser string/large_string, nunca int/float.
- Ponto de milhar é proibido no locale vírgula. Os estados divulgada/sigilo/
  ausente são preservados; a renda é Decimal, sem conversão intermediária em float.
  Para números nativos de Parquet, o locale textual não se aplica.
- População/domicílios ausentes abortam. Denominador ausente também aborta.
  Denominador X vira peso interno zero APENAS se todas as medidas de renda
  mapeadas forem X; conta universo suprimido e deixa a cobertura null, em vez
  de sugerir cobertura completa. A soma de responsáveis passa a representar
  apenas a parcela conhecida do universo.
- Corpos d'água cartográficos 4300001 e 4300002 são descartados nas duas fontes.
  Fora dessa denylist, o conjunto municipal do PIB precisa coincidir exatamente
  com o do Censo; erros, duplicatas e códigos incompletos abortam.

Execução (na raiz, após instalar as dependências):

```bash
.venv/bin/python etl_pipeline/02_ingest_ibge_real.py \
  --manifest /caminho/manifesto-verificado.json \
  --setores /caminho/setores.csv \
  --pib /caminho/pib.csv \
  --output-dir data/processed_real \
  --date 2026-10-25
```

O destino padrão é separado da demo e ignorado pelo Git. Não misture execuções
com recortes diferentes no mesmo diretório: arquivos antigos não são removidos
automaticamente; use diretório vazio ou novo por release. O lote inteiro não é
transacional (cada arquivo é publicado atomicamente). O staging SQLite é temporário
em disco, exige espaço adicional e é removido ao terminar. Não há ordenação exigida
na entrada; o processamento carrega somente um município de setores em memória.

Todos os resumos são bottom-up. Regiões/UFs fora do recorte têm resumo null, e os
metadados avisam que a cobertura corresponde aos arquivos fornecidos. Integridade
do join **não** comprova que os setores de um município estão completos: essa
cobertura ainda deve ser conferida no inventário da publicação.

`pib_mil_reais_exato` e `massa_rendimento_considerada` são strings decimais para
reconciliação sem perda. O primeiro preserva inclusive frações de mil reais;
`pib_mil_reais` numérico e bilhões são projeções para a interface. Rollups usam o
campo exato, nunca a projeção float. Massa considerada é só a parcela divulgada
(e reconstruída pela média se não houver massa), não imputação da renda oculta.
A média municipal é calculada dos setores, nunca de médias de bairros arredondadas.
PIB per capita é derivado com população do Censo; metadados registram ambos os
períodos quando o ano do PIB difere do ano populacional. Não é automaticamente
o indicador per capita oficial da tabela original.
