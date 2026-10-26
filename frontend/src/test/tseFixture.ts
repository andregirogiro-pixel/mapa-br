// Somente testes: códigos, votos e pontos SINTÉTICOS; nunca publicar como fonte oficial.
import fs from 'node:fs';
import type { IndicadoresEleitorais, MunicipioTse } from '../types/tseContract';
export function electionIndicators(aptos = 100, comparecimento = 80, brancos = 5, nulos = 5): IndicadoresEleitorais {
  const ratio = (n: number, d: number) => d ? Math.round(n / d * 10000) / 10000 : null;
  const validos = comparecimento - brancos - nulos;
  return { eleitores_aptos: aptos, comparecimento, abstencao: aptos - comparecimento,
    votos_nominais: validos, votos_legenda: 0, votos_validos: validos, votos_brancos: brancos, votos_nulos: nulos,
    comparecimento_proporcao: ratio(comparecimento, aptos), abstencao_proporcao: ratio(aptos - comparecimento, aptos),
    votos_validos_proporcao: ratio(validos, comparecimento), votos_brancos_proporcao: ratio(brancos, comparecimento), votos_nulos_proporcao: ratio(nulos, comparecimento) };
}
export function tseFixture(): MunicipioTse {
  const geometry = JSON.parse(fs.readFileSync('public/geo/demo/setores/42/4205407.geojson', 'utf8'));
  const feature = geometry.features.find((f: { properties: { cd_setor: string } }) => f.properties.cd_setor === '420540700000002A');
  const ring = feature.geometry.coordinates[0] as [number, number][];
  const x = ring.map(p => p[0]), y = ring.map(p => p[1]);
  const indicadores = electionIndicators();
  return { metadata: { schema_version: '2.0', updated_at: '2026-10-26', nivel: 'municipio_tse',
    cd_uf: '42', cd_mun: '4205407', cd_mun_tse: '00001', ano_eleicao: 2022, nr_turno: 1, cargo: 'Presidente',
    aviso_metodologico: 'SIMULAÇÃO: votos por local de votação contido no perímetro; não representam residência.', tipo_dados: 'simulados' },
    resumo_municipio: { ...electionIndicators(150, 120, 8, 7), total_locais: 2, locais_georreferenciados: 1,
      locais_nao_alocados: 1, cobertura_alocacao_eleitorado: .6667 },
    locais_votacao: [{ id_local: 'tse:00001:0001:0001', nr_zona: '0001', nr_local_votacao: '0001', nm_local_votacao: 'Escola sintética A',
      nm_bairro_tse: 'Nome livre TSE, não é chave IBGE', nr_secoes: 2, metodo_geo: 'geocodificacao_endereco',
      coordenadas: [(Math.min(...x) + Math.max(...x)) / 2, (Math.min(...y) + Math.max(...y)) / 2],
      cd_setor_alocado: '420540700000002A', id_agregacao_alocada: 'demo:4205407:grupo-01', indicadores },
    { id_local: 'tse:00001:0001:0002', nr_zona: '0001', nr_local_votacao: '0002', nm_local_votacao: 'Escola sintética B',
      nm_bairro_tse: null, nr_secoes: 1, metodo_geo: 'nao_georreferenciado', coordenadas: null,
      cd_setor_alocado: null, id_agregacao_alocada: null, indicadores: electionIndicators(50, 40, 3, 2) }],
    por_agregacao: [{ id_agregacao: 'demo:4205407:grupo-01', metodo_vinculo: 'ponto_local_votacao_no_poligono',
      total_locais: 1, total_secoes: 2, id_locais: ['tse:00001:0001:0001'], indicadores }],
  };
}
