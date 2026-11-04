import { login } from './auth';
import { writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
test('场馆、电网、拓扑、设备与告警回放完整联动', async ({ page, request }) => {
  await login(page, request);
  page.setDefaultTimeout(15000);
  const errors: string[] = [];
  const requests = new Set<string>();
  const external = new Set<string>();
  page.on('request', (request) => {
    requests.add(request.url());
    if (new URL(request.url()).hostname !== 'localhost') external.add(request.url());
  });
  const failed: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`);
  });
  await page.goto('/');

  await expect(page.getByRole('heading', { name: '全景智慧供电保障系统' })).toBeVisible();
  await expect(page.locator('.cesium-widget canvas')).toBeVisible({ timeout: 45000 });
  await expect(page.locator('.scene-error')).toHaveCount(0);
  await expect(page.locator('.scene-loading')).toHaveCount(0, { timeout: 45000 });
  await page.getByRole('button', { name: '暂停模拟', exact: true }).click();
  await page.screenshot({ timeout: 15000, path: 'docs/venue.png' });
  await page.getByRole('button', { name: '图层管理', exact: true }).click();
  await page.getByRole('checkbox', { name: '城市建筑与道路' }).uncheck();
  await page.getByRole('checkbox', { name: '城市建筑与道路' }).check();
  await page.getByRole('button', { name: '关闭图层管理' }).click();
  await page.getByRole('button', { name: '供电单线图', exact: true }).click();
  await page.getByRole('button', { name: '诸光变电站', exact: true }).click();
  await expect(page.locator('.asset-heading h3')).toHaveText('诸光变电站');

  await page.getByRole('button', { name: '诸光—会展 Ⅰ线', exact: true }).focus();
  await page.keyboard.press('Enter');

  await expect(page.locator('.asset-heading h3')).toHaveText('诸光—会展 Ⅰ线');
  await page.screenshot({ timeout: 15000, path: 'docs/topology.png' });
  await page.getByRole('button', { name: '关闭接线图' }).click();
  await page.getByRole('slider', { name: '遥测回放时间轴' }).fill('35');
  await expect(page.locator('.event-item b')).toContainText('温度偏高');
  await page.getByRole('slider', { name: '遥测回放时间轴' }).fill('55');
  await expect(page.locator('.event-item b')).toContainText('运行平稳');
  await page.getByRole('button', { name: '设备监测 EQUIPMENT' }).click();
  await expect(page.getByTestId('equipment-canvas').locator('canvas')).toBeVisible();
  await expect(page.locator('.scene-loading')).toHaveCount(0);
  await page.getByRole('button', { name: '分解视图', exact: true }).click();
  await page.getByRole('button', { name: '内部剖视', exact: true }).click();
  await page.getByRole('button', { name: '铜排母线', exact: true }).click();
  await expect(page.locator('.component-detail>b')).toHaveText('铜排母线');
  await page.screenshot({ timeout: 15000, path: 'docs/equipment.png' });
  await page.getByRole('button', { name: '返回场馆', exact: true }).click();
  await expect(page.locator('.cesium-widget canvas')).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: '全景态势 OVERVIEW' }).click();
  await page.screenshot({ timeout: 15000, path: 'docs/city.png' });
  await page.getByRole('combobox', { name: '选择保障区域' }).selectOption('hongqiao');
  await expect(page.locator('.table-footer')).toContainText('共 2 个保障对象');
  await expect(page.locator('.asset-heading h3')).toHaveText('虹桥变电站');
  await expect(page.getByRole('button', { name: '接待酒店 Reception hotels 00' })).toBeDisabled();
  expect(external.size).toBe(0);
  writeFileSync(
    'docs/browser-verification.json',
    JSON.stringify(
      {
        viewport: '1920x1080',
        uniqueRequests: requests.size,
        externalRequests: external.size,
        pageErrors: errors,
        failedResponses: failed,
        scenarios: [
          'venue',
          'layers',
          'topology',
          'alarm-replay',
          'equipment-explode-cutaway',
          'city',
          'region-filter',
        ],
      },
      null,
      2,
    ) + '\n',
  );
  expect(errors).toEqual([]);
  expect(failed).toEqual([]);
});
