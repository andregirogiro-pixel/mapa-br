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

O download/conversor e o auditor de malhas oficiais **ainda não foram
implementados**. A aprovação de uma futura release requer:

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
