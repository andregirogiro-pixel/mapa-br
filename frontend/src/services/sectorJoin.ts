import type { BairroDetalhe } from '../types/contract';
import { cdSetorSchema } from '../types/contract';

// A mesma malha de setores serve os dois tipos de grupo. Nenhum dissolve
// ou conversão numérica de CD_SETOR é necessário no cliente.
export function buildSectorToGroupMap(bairros: readonly BairroDetalhe[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const bairro of bairros) {
    for (const code of bairro.cd_setores) {
      cdSetorSchema.parse(code);
      if (result.has(code)) throw new Error(`Setor atribuído a mais de um grupo: ${code}`);
      result.set(code, bairro.id_agregacao);
    }
  }
  return result;
}

export function groupForSectorFeature(properties: Record<string, unknown>, reverse: ReadonlyMap<string, string>): string | null {
  const code = cdSetorSchema.parse(properties.CD_SETOR);
  return reverse.get(code) ?? null;
}
