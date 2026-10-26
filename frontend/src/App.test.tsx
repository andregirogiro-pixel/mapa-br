import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { DataLoader } from './services/dataLoader';
import { base, fixtureFetcher } from './test/fixtures';

vi.mock('./components/MapViewport', () => ({ default: () => null }));

beforeEach(() => window.history.replaceState(null, '', '/'));
describe('drill-down interativo', () => {
  it('percorre os níveis, seleciona fallback pelo id e limpa filhos ao trocar UF', async () => {
    const user = userEvent.setup(); const fetcher = fixtureFetcher();
    render(<App loader={new DataLoader(`${base}brasil.json`, fetcher)} />);
    const panel = screen.getByRole('region', { name: 'Exploração territorial' });
    await user.click(await screen.findByRole('button', { name: 'Sul' }));
    await waitFor(() => expect(within(panel).getByRole('heading', { level: 1 })).toHaveTextContent('Sul'));
    await user.click(await screen.findByRole('button', { name: 'Santa Catarina (SC)' }));
    await user.click(await within(panel).findByRole('button', { name: /Florianópolis/ }));
    await user.click(await within(panel).findByRole('button', { name: /Área sem bairro oficial/ }));
    expect(await screen.findByText('Agrupamento de Setores por Subdistrito/Distrito')).toBeInTheDocument();
    expect(window.location.search).toContain('id_agregacao=demo%3A4205407%3Agrupo-01');
    expect(screen.getByText('420540700000002A')).toBeInTheDocument();
    expect(screen.getByText(/1 setor sob sigilo/)).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Selecionar UF' }), '35');
    await within(panel).findByRole('button', { name: /Campinas/ });
    expect(window.location.search).not.toContain('id_agregacao');
    expect(window.location.search).not.toContain('cd_mun');
    expect(screen.queryByText('420540700000002A')).not.toBeInTheDocument();
  });
  it('aceita link profundo e acompanha voltar/avançar do navegador', async () => {
    window.history.replaceState(null, '', '?level=municipio&cd_uf=42&cd_mun=4205407');
    render(<App loader={new DataLoader(`${base}brasil.json`, fixtureFetcher())} />);
    expect(await screen.findByRole('heading', { name: 'Florianópolis', level: 1 })).toBeInTheDocument();
    act(() => { window.history.pushState(null, '', '?level=uf&cd_uf=35'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('São Paulo'));
    expect(screen.queryByRole('heading', { level: 1, name: 'Florianópolis' })).not.toBeInTheDocument();
  });
  it('exibe resumo de UF sem detalhe sem buscar municípios', async () => {
    window.history.replaceState(null, '', '?level=uf&cd_uf=12'); const fetcher = fixtureFetcher();
    render(<App loader={new DataLoader(`${base}brasil.json`, fetcher)} />);
    expect(await screen.findByText('O desdobramento municipal não faz parte do recorte carregado.')).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('não mostra 100% de cobertura quando o JSON arredondou a parcela não divulgada', async () => {
    render(<App loader={new DataLoader(`${base}brasil.json`, fixtureFetcher())} />);
    expect(await screen.findByText('< 100%')).toBeInTheDocument();
  });
  it('volta pela hierarquia com a métrica compartilhada e o histórico sincronizados', async () => {
    window.history.replaceState(null, '', '?level=municipio&cd_uf=42&cd_mun=4205407');
    const user = userEvent.setup();
    render(<App loader={new DataLoader(`${base}brasil.json`, fixtureFetcher())} />);
    await screen.findByRole('heading', { level: 1, name: 'Florianópolis' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Colorir por' }), 'setores_sob_sigilo');
    await user.click(screen.getByRole('button', { name: /Voltar nível/ }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Santa Catarina'));
    expect(window.location.search).not.toContain('cd_mun');
    await user.click(screen.getByRole('button', { name: /Voltar nível/ }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Sul'));
    expect(screen.getByRole('combobox', { name: 'Colorir por' })).toHaveValue('setores_sob_sigilo');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Colorir por' }), 'pib_total_bi');
    await user.click(screen.getByRole('button', { name: /Voltar nível/ }));
    await waitFor(() => expect(window.location.search).toBe(''));
    expect(screen.getByRole('combobox', { name: 'Colorir por' })).toHaveValue('pib_total_bi');
  });
  it('avisa o fallback de PIB nos setores e retoma a métrica ao voltar à UF', async () => {
    window.history.replaceState(null, '', '?level=uf&cd_uf=42');
    const user = userEvent.setup(); const fetcher = fixtureFetcher();
    render(<App loader={new DataLoader(`${base}brasil.json`, fetcher)} />);
    const panel = screen.getByRole('region', { name: 'Exploração territorial' });
    await within(panel).findByRole('button', { name: /Florianópolis/ });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Colorir por' }), 'pib_per_capita');
    await user.click(within(panel).getByRole('button', { name: /Florianópolis/ }));
    await screen.findByText(/O IBGE não calcula PIB para bairros/);
    expect(screen.getByRole('combobox', { name: 'Colorir por' })).toHaveValue('pib_per_capita');
    expect(within(panel).getByText('Renda do responsável · quantis')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Auditoria de agregação' })).toHaveTextContent('Peso com renda divulgada');
    await user.click(screen.getByRole('button', { name: /Voltar nível/ }));
    await within(panel).findByRole('button', { name: /Florianópolis/ });
    expect(screen.queryByText(/O IBGE não calcula PIB para bairros/)).not.toBeInTheDocument();
    expect(within(panel).getByText('PIB por habitante · quantis')).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

});
