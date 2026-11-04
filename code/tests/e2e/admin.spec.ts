import { test, expect } from '@playwright/test';
import { login } from './auth';
test('独立管理后台：工作台、台账编辑回填、测点、拓扑、模型与工单页面', async ({
  page,
  request,
}) => {
  await login(page, request);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://localhost:5198/dashboard');
  await expect(page.getByText('综合业务管理平台')).toBeVisible();
  await page.goto('http://localhost:5198/assets/stations');
  await expect(page.getByRole('heading', { name: '变电站与场所台账' })).toBeVisible();
  await expect(page.locator('.ant-table-tbody')).toContainText('国家会展中心');
  await page
    .locator('.ant-table-tbody tr')
    .filter({ hasText: '诸光变电站' })
    .getByRole('button', { name: '编辑' })
    .click();
  await expect(page.getByLabel('经度', { exact: true })).toHaveValue('121.285');
  await page.getByRole('button', { name: '取 消' }).click();
  await page.goto('http://localhost:5198/monitoring/points');
  await expect(page.locator('.ant-table-tbody')).toContainText('柜内温度');
  await page.goto('http://localhost:5198/topology/graph');
  await expect(page.locator('.ant-table-tbody')).toContainText('CLOSED');
  await page.goto('http://localhost:5198/scenes/models');
  await expect(page.getByRole('heading', { name: '模型资源与资产绑定' })).toBeVisible();
  await page.goto('http://localhost:5198/work-orders');
  await expect(page.getByRole('heading', { name: '运维工单管理' })).toBeVisible();
  await page.screenshot({ path: 'docs/testing/admin.png', fullPage: true });
  expect(errors).toEqual([]);
});
