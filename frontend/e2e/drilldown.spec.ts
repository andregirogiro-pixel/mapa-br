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
