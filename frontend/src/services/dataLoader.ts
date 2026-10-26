import { brasilSchema, ufSchema, municipioSchema, payloadSchema } from '../types/contract';
import type { Navigation } from '../state/navigation';
import type { BrasilPayload, UfPayload, MunicipioPayload } from '../types/contract';

export interface LoadedData { index: BrasilPayload; uf?: UfPayload; municipio?: MunicipioPayload }
interface Pending { controller: AbortController; users: number }
export class DataHttpError extends Error {
  constructor(readonly status: number) { super(`Não foi possível carregar os dados (HTTP ${status}).`); }
}
const aborted = () => new DOMException('Carregamento cancelado', 'AbortError');

export class DataLoader {
  private readonly cache = new Map<string, Promise<unknown>>();
  private readonly pending = new Map<string, Pending>();
  constructor(readonly indexUrl: string,
    private readonly fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init)) {}

  resolve(relativePath: string, parentFileUrl: string): string {
    return new URL(relativePath, parentFileUrl).href;
  }

  clear(): void {
    const entries = [...this.pending.values()];
    this.pending.clear(); this.cache.clear();
    for (const entry of entries) entry.controller.abort();
  }

  request(url: string, signal: AbortSignal, parse: (raw: unknown) => unknown = raw => payloadSchema.parse(raw)): Promise<unknown> {
    if (signal.aborted) return Promise.reject(aborted());
    let promise = this.cache.get(url);
    if (!promise) {
      const entry: Pending = { controller: new AbortController(), users: 0 };
      this.pending.set(url, entry);
      promise = this.fetcher(url, { signal: entry.controller.signal, headers: { Accept: 'application/json' } }).then(async response => {
        if (!response.ok) throw new DataHttpError(response.status);
        return parse(await response.json());
      });
      this.cache.set(url, promise);
      const current = promise;
      void promise.then(() => {
        if (this.pending.get(url) === entry) this.pending.delete(url);
      }, () => {
        if (this.cache.get(url) === current) this.cache.delete(url);
        if (this.pending.get(url) === entry) this.pending.delete(url);
      });
    }
    const entry = this.pending.get(url);
    if (entry) entry.users += 1;
    const current = promise;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (done: () => void) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', cancel);
        if (entry) {
          entry.users -= 1;
          if (entry.users === 0 && this.pending.get(url) === entry) {
            this.pending.delete(url);
            if (this.cache.get(url) === current) this.cache.delete(url);
            entry.controller.abort();
          }
        }
        done();
      };
      const cancel = () => finish(() => reject(aborted()));
      signal.addEventListener('abort', cancel, { once: true });
      void current.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
    });
  }

  async load(nav: Navigation, signal: AbortSignal): Promise<LoadedData> {
    const index = brasilSchema.parse(await this.request(this.indexUrl, signal));
    if (nav.level === 'pais') return { index };
    if (nav.level === 'regiao') {
      if (!index.regioes.some(r => r.cd_regiao === nav.cd_regiao)) throw new Error('Região não encontrada.');
      return { index };
    }
    const entry = index.ufs.find(u => u.metadata.cd_uf === nav.cd_uf);
    if (!entry) throw new Error('UF não encontrada.');
    if (!entry.dados_disponiveis || !entry.arquivo) {
      if (nav.level !== 'uf') throw new Error('O município não faz parte do recorte carregado.');
      return { index };
    }
    const ufUrl = this.resolve(entry.arquivo, this.indexUrl);
    const uf = ufSchema.parse(await this.request(ufUrl, signal));
    if (uf.metadata.cd_uf !== nav.cd_uf || uf.municipios_resumo.some(m => !m.cd_mun.startsWith(nav.cd_uf))) {
      throw new Error('Os dados da UF são incompatíveis com a seleção.');
    }
    if (nav.level === 'uf') return { index, uf };
    const municipality = uf.municipios_resumo.find(m => m.cd_mun === nav.cd_mun);
    if (!municipality) throw new Error('Município não encontrado nesta UF.');
    const municipalityUrl = this.resolve(municipality.arquivo, ufUrl);
    const municipio = municipioSchema.parse(await this.request(municipalityUrl, signal));
    if (municipio.metadata.cd_uf !== nav.cd_uf || municipio.municipio.cd_mun !== nav.cd_mun) {
      throw new Error('Os dados municipais são incompatíveis com a seleção.');
    }
    if (nav.level === 'bairro' && !municipio.municipio.bairros.some(b => b.id_agregacao === nav.id_agregacao)) {
      throw new Error('Bairro ou agrupamento não encontrado neste município.');
    }
    return { index, uf, municipio };
  }
}
