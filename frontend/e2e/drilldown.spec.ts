import { test, expect } from '@playwright/test';
import sc from '../../data/processed/uf/42.json' with { type: 'json' };

test('carga progressiva real, cinco níveis e histórico', async ({ page }) => {
  const requested: string[] = []; const errors: string[] = [];
  page.on('request', req => { if (req.url().includes('/data/processed/')) requested.push(new URL(req.url()).pathname); });
  page.on('pageerror', err => errors.push(err.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Santa Catarina (SC)' })).toBeVisible();
  expect(requested).toEqual(['/data/processed/brasil.json']);
  await page.screenshot({ path: '/tmp/mapa-br-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Sul', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sul');
  await page.getByRole('button', { name: 'Santa Catarina (SC)' }).click();
  const map = page.getByRole('region', { name: 'Exploração territorial' });
  await expect(map.getByRole('button', { name: /Florianópolis/ })).toBeVisible();
  expect(requested).toEqual(['/data/processed/brasil.json', '/data/processed/uf/42.json']);
  await map.getByRole('button', { name: /Florianópolis/ }).click();
  await map.getByRole('button', { name: /Área sem bairro oficial/ }).click();
  await expect(page.getByText('Agrupamento de Setores por Subdistrito/Distrito')).toBeVisible();
  await expect(page.getByText('420540700000002A', { exact: true })).toBeVisible();
  expect(requested).toEqual(['/data/processed/brasil.json', '/data/processed/uf/42.json', '/data/processed/municipios/42/4205407.json']);
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Florianópolis');
  await page.goForward();
  await expect(page.getByText('420540700000002A', { exact: true })).toBeVisible();
  expect(requested).toHaveLength(3);
  expect(errors).toEqual([]);
});

test('troca rápida de UF descarta resposta tardia', async ({ page }) => {
  let release: (() => Promise<void>) | undefined;
  await page.route('**/data/processed/uf/42.json', route => new Promise<void>(resolve => {
    release = async () => { await route.fulfill({ json: sc }); resolve(); };
  }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Santa Catarina (SC)' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Selecionar UF' }).selectOption('42');
  await expect.poll(() => Boolean(release)).toBe(true);
  await page.getByRole('combobox', { name: 'Selecionar UF' }).selectOption('35');
  await expect(page.getByRole('region', { name: 'Exploração territorial' }).getByRole('button', { name: /Campinas/ })).toBeVisible();
  await release!();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('São Paulo');
  await expect(page.getByRole('region', { name: 'Exploração territorial' }).getByRole('button', { name: /Florianópolis/ })).toHaveCount(0);
});

test('link profundo no celular e UF sem desdobramento', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?level=bairro&cd_uf=42&cd_mun=4205407&id_agregacao=demo%3A4205407%3Agrupo-01');
  await expect(page.getByText('420540700000002A', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/mapa-br-mobile.png', fullPage: true });
  await page.getByRole('combobox', { name: 'Selecionar UF' }).selectOption('12');
  await expect(page.getByText('O desdobramento municipal não faz parte do recorte carregado.')).toBeVisible();
  await expect(page).not.toHaveURL(/cd_mun|id_agregacao/);
});

test('MapLibre offline: malhas lazy, clique setorial e métrica sem rede externa', async ({ page }) => {
  const external: string[] = []; const geometries: string[] = [];
  page.on('request', req => {
    const url = new URL(req.url());
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') external.push(req.url());
      if (url.pathname.endsWith('.geojson')) geometries.push(url.pathname);
    }
  });
  await page.route(/^https?:\/\//, route => {
    const host = new URL(route.request().url()).hostname;
    return host === '127.0.0.1' || host === 'localhost' ? route.continue() : route.abort();
  });
  await page.goto('/');
  const map = page.getByTestId('demo-map');
  await expect(map).toHaveAttribute('data-ready', 'true');
  const originalCanvas = await map.locator('canvas').elementHandle();
  expect(geometries).toEqual(['/geo/demo/ufs.geojson']);
  await page.getByRole('combobox', { name: 'Selecionar UF' }).selectOption('42');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Santa Catarina');
  await expect(map).toHaveAttribute('data-ready', 'true');
  expect(geometries).toContain('/geo/demo/municipios/42.geojson');
  expect(geometries.some(p => p.includes('/setores/'))).toBe(false);
  await page.getByRole('region', { name: 'Exploração territorial' }).getByRole('button', { name: /Florianópolis/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Florianópolis');
  await expect(map).toHaveAttribute('data-ready', 'true');
  expect(geometries).toContain('/geo/demo/setores/42/4205407.geojson');
  const bounds = await map.boundingBox();
  await map.locator('canvas').click({ position: { x: bounds!.width * .5, y: bounds!.height * .30 } });
  await expect(page).toHaveURL(/level=bairro/);
  await expect(page.getByText('Agrupamento de Setores por Subdistrito/Distrito', { exact: true })).toBeVisible();
  await expect(map).toHaveAttribute('data-ready', 'true');
  await expect(page).toHaveURL(/id_agregacao=demo%3A4205407%3Agrupo-01/);
  await page.screenshot({ path: '/tmp/mapa-br-offline-webgl.png', fullPage: true });
  const canvasBefore = await map.locator('canvas').screenshot();
  await page.getByRole('combobox', { name: 'Colorir por' }).selectOption('setores_sob_sigilo');
  await expect.poll(async () => !canvasBefore.equals(await map.locator('canvas').screenshot())).toBe(true);
  const count = geometries.length;
  await page.getByRole('combobox', { name: 'Colorir por' }).selectOption('cobertura_renda_proporcao');
  await expect(map).toHaveAttribute('data-ready', 'true');
  expect(geometries).toHaveLength(count);
  expect(external).toEqual([]);
  expect(await originalCanvas!.evaluate(canvas => canvas.isConnected)).toBe(true);
  await expect(map.locator('canvas')).toHaveCount(1);
});


test('PIB é preservado no seletor e usa renda na pintura intramunicipal com navegador offline', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false }));
  await page.goto('/?level=uf&cd_uf=42');
  const panel = page.getByRole('region', { name: 'Exploração territorial' });
  await panel.getByRole('button', { name: /Florianópolis/ }).waitFor();
  await page.getByRole('combobox', { name: 'Colorir por' }).selectOption('pib_per_capita');
  await panel.getByRole('button', { name: /Florianópolis/ }).click();
  await expect(page.getByText(/O IBGE não calcula PIB para bairros/)).toBeVisible();
  await expect(page.getByTestId('demo-map')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByRole('combobox', { name: 'Colorir por' })).toHaveValue('pib_per_capita');
  await panel.getByRole('button', { name: /Área sem bairro oficial/ }).click();
  await expect(page.getByText('420540700000002A', { exact: true })).toBeVisible();
  await expect(page.getByTestId('demo-map')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: /Voltar nível/ }).click();
  await page.getByRole('button', { name: /Voltar nível/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Santa Catarina');
  await expect(page.getByText(/O IBGE não calcula PIB para bairros/)).toHaveCount(0);
  await expect(panel.getByText('PIB por habitante · quantis')).toBeVisible();
});
