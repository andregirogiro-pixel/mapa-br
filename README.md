# mapa-br

Base de uma plataforma analítica geográfica do Brasil: País → Região → UF →
Município → Bairro/Setor. Este primeiro passo prepara diretórios, contrato de
dados e um gerador offline. A aplicação React será implementada depois.

## Gerar os dados de demonstração

Python 3.11 ou superior, sem dependências externas para este comando:

```bash
python3 etl_pipeline/01_build_uf_base.py --date 2026-10-25
python3 -m unittest discover -s etl_pipeline/tests -v
```

Sem `--date`, usa a data UTC de execução. Para outro destino, use
`--output-dir /tmp/mapa-br-demo`.

- `data/processed/brasil.json`: resumo nacional, cinco regiões e as 27 UFs.
- `data/processed/uf/35.json` e `42.json`: municípios e bairros demonstrativos
  de SP e SC, com exemplos de fallback por setores.
- `frontend/`: reservado para React + Vite; sem app neste passo.
- `notebooks/`: reservado para exploração.
- `data/raw/`: arquivos brutos locais ignorados pelo Git.

**Todos os indicadores são simulados.** Só nomes, siglas e códigos de UF,
região e município correspondem à divisão oficial. Códigos de bairros e setores
são fixtures de formato, não registros oficiais verificados. Não há geometrias.
As amostras municipais não representam a totalidade de cada estado.

O índice aponta para a partição disponível pelo campo `arquivo`, relativo a
`brasil.json`. O frontend deverá fazer fetch dessa partição só após seleção da
UF. As outras 25 UFs têm resumo e `dados_disponiveis: false`.

O fallback recebe setores já associados a um grupo territorial, conserva seus
códigos e calcula renda usando o universo explícito de responsáveis e cobertura divulgada. Prioriza massa de rendimento sobre médias setoriais arredondadas; não usa
setores sob sigilo como renda zero. Não infere bairros nem calcula
Gini a partir de médias. Consulte [AGENTS.md](AGENTS.md) para o contrato completo.

## Dependências para futura ingestão

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r etl_pipeline/requirements.txt
```

O arquivo de requisitos declara faixas compatíveis para a próxima etapa; não é
um lockfile. O gerador e seus testes usam apenas a biblioteca padrão. Não há
download de bases, API, credenciais ou serviços necessários nesta etapa.

## Revisão do contrato (1.1)

- Setores aceitam 15 dígitos e um sufixo opcional A–Z, preservado no join.
  Esse é o perfil das fixtures; não verifica uma release real do IBGE.
- Na entrada da agregação, `domicilios` conta o total físico e
  `responsaveis_renda` é obrigatório e corresponde ao universo da renda.
- `massa_rendimento_setor` (BRL/mês) é opcional e prevalece sobre a média;
  exige o mesmo universo. `status_renda: "sigilo"` é explícito; ausência
  genérica é contabilizada separadamente. Ainda não há parser de CSV do Censo.
- `cobertura_renda_proporcao` está em [0,1], não em porcentagem. Sem cobertura,
  a renda é null. Arredondamento monetário final: Decimal/ROUND_HALF_EVEN.
- PIB canônico: `pib_mil_reais` inteiro nas fixtures. `pib_total_bi` é derivado.
  O agregador rejeita frações em vez de truncá-las. Uma fonte com frações
  precisará de adaptação decimal explícita antes de ser integrada.

A nomenclatura das variáveis, os universos, os marcadores de ausência e a
especificação dos códigos deverão ser confirmados no dicionário do arquivo
escolhido. Os dados continuam simulados; `release_censo` e
`mapeamento_variaveis_censo` permanecem nulos.
