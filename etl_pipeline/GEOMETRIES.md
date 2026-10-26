# Geometrias sintéticas e critérios para publicação oficial

A demonstração usa exclusivamente os GeoJSONs pequenos e versionados em
`frontend/public/geo/demo`. Gere-os com `python3 etl_pipeline/build_demo_geometries.py`
a partir das fixtures de `data/processed`. O gerador não acessa a rede, não
converte IDs numéricos em string e rejeita dados não declarados como simulados.
Não é uma malha aproximada oficial: são retângulos sintéticos para desenvolver
navegação, promoteId, feature-state, sigilo e join de setores para grupos.

A API de Malhas e o portal não fazem parte do frontend, do build nem do staging
03. Geometrias reais futuras devem ser baixadas SOMENTE dos arquivos estáticos
HTTPS em ftp.ibge.gov.br ou geoftp.ibge.gov.br. Diretórios de referência incluem
Censos/Censo_Demografico_2022 e organizacao_do_territorio/malhas_territoriais;
é necessário conferir o caminho, revisão e documentação de cada arquivo antes
de usar. Não adivinhar ZIPs nem misturar uma malha administrativa atual com
agregados de 2022 sem comprovar compatibilidade. Cache e recibos conservam URL,
URL final, tamanho, SHA local e data; o hash local não é assinatura do IBGE.

O preparador e a auditoria do primeiro recorte oficial estão implementados
(ver a seção da entrega abaixo). Novas releases devem cumprir estes critérios:

- Conferir os tipos originais dos atributos antes de processar: códigos devem
  ser textuais. Reusar validate_code/normalize_code de core_contract; não usar
  str(), astype(str), padding ou truncamento para reparar zeros perdidos.
- Validar CD_UF (2), CD_MUN (7), CD_BAIRRO (9–10 quando existente) e CD_SETOR
  (15 dígitos com sufixo opcional A–Z), vínculos/prefixos e unicidade. Reusar
  WATER_BODY_DENYLIST para 4300001 e 4300002 nas fontes, registrando exclusões.
- Comparar a malha setorial contra o inventário COMPLETO do básico de SC:
  16.736 setores na revisão 20260520. Incluir os 301 sem linha de renda, que
  têm população zero mas somam 230 domicílios físicos. Reportar conjuntos
  faltantes/extras e duplicatas; igualdade de contagem sozinha não basta.
- Exigir correspondência 1:1 setor–feature. Partes de uma mesma entidade devem
  compor um MultiPolygon identificado uma única vez; não aceitar duplicatas
  como se fossem novos setores. Preservar todos os setores válidos do inventário.
- Conferir CRS declarado, geometria não vazia/válida e conversão documentada
  para GeoJSON WGS84. Verificar release temporal, mudanças territoriais e
  versão do dicionário, além de igualdade dos códigos. Não corrigir topologia
  silenciosamente nem afirmar compatibilidade apenas pelo prefixo do setor.
- Particionar municípios por UF e setores por município. O nível 5 usa uma
  malha setorial e o lookup CD_SETOR → id_agregacao tanto para bairros oficiais
  quanto para fallback. Não depende de dissolve no navegador.
- Publicar somente após auditoria aprovada, com relatório e proveniência, em
  árvore separada da demo. Shapefile/GeoPackage e geometrias oficiais pesadas
  permanecem fora do Git. O erro/sigilo de renda não muda o inventário espacial.

As quantidades acima registram a publicação auditada, não uma constante para
todas as revisões futuras. Alterações legítimas exigem nova conferência e
relatório explícito; nunca remover setores para fazer a contagem coincidir.

## Entrega oficial: Brasil → SC → Florianópolis

A preparação está implementada em `prepare_official_geometries.py`. O modo
oficial é cartográfico, independente do contrato estatístico 2.0: não fabrica
população, renda, cobertura, zeros ou bairros para satisfazer os schemas.

Fontes fixadas: `malha_com_atributos` do Censo 2022, publicação listada em
13/11/2024 no FTP, `BR_distritos_CD2022.zip`, `SC_setores_CD2022.zip` e
`Dicionario_de_dados_malha_agregados.xlsx`. A URL de organização territorial no
FTP retornou 404 e o geoftp retornou CONNECT 403 na configuração inicial. A
alternativa selecionada usa a mesma referência censitária: os contornos de UF
são a união dos distritos nacionais, e os municipais de SC são a união dos seus
distritos. Não foi substituída por malha administrativa de outro ano.

```bash
.venv/bin/pip install -r etl_pipeline/requirements-geometry.txt
.venv/bin/python etl_pipeline/prepare_official_geometries.py
```

O script usa o cache/recibos do 03 e hashes fixados por arquivo, recusando revisões
silenciosas. O schema DBF deve declarar os códigos como texto; a validação reusa
`normalize_code` do motor. A comparação é por conjuntos de identificadores com
o básico completo rev. 20260520, incluindo todos os setores sem linha de renda.
O dicionário básico também é fixado. Duplicatas, divergências de conjuntos,
pertencimento municipal inconsistente e geometria inválida no recorte exportado
bloqueiam a publicação e geram diagnóstico no manifesto de auditoria.

A edição nacional contém uma feição final sem CD_DIST/CD_MUN, vinculada à UF 43.
Ela contribui somente para essa UF, sem fabricar identificadores de descendentes;
a posição e a política da exceção estão registradas no relatório. Uma
Autointerseção no setor de São José `421660213000199` permanece na referência
bruta de SC e é reportada. Esse setor não pertence ao recorte setorial publicado.
Os 1.004 setores de Florianópolis são preservados individualmente, sem reparos.

As referências integrais em EPSG:4674 ficam em
`data/raw/geometries_reference/censo2022/`, separadas do GeoJSON de exibição em
WGS84 EPSG:4326. A contenção de cada setor de Florianópolis é verificada contra
o limite municipal integral; áreas residuais são medidas em EPSG:31982, com
tolerância explícita de 1 m². Não se valida espacialmente contra versão
simplificada. A simplificação só ocorre para cobertura válida, por
`coverage_simplify`, com verificação da cobertura, matriz de adjacência,
identificadores e geometrias. Se não elegível, conserva os limites integrais;
os setores não são simplificados. Tolerâncias e quantidades de vértices ficam
no relatório, sem arredondamento adicional de coordenadas.

A árvore local em `frontend/public/geo/official/` contém `catalogo.json`,
`ufs.geojson`, `municipios/42.geojson`, `setores/42/4205407.geojson` e
`proveniencia.json`. Os inventários `*.inventory.json` também são particionados
por nível, sem listas municipais ou setoriais na carga nacional. Não consulta o
IBGE na abertura ou no build. Geometrias
oficiais e referências pesadas continuam ignoradas pelo Git; a auditoria compacta
em `manifests/official_geometry.audit.json` e o preparador são versionáveis.
O build copia a árvore pública preparada para `dist/geo/official/`.

A renda e o TSE permanecem fora desta entrega. Não há lookup setor–bairro
aprovado; a navegação usa os setores diretamente. Uma auditoria cartográfica
aprovada para esse recorte não libera a ingestão estatística bloqueada.
