import { login } from './auth';
import { test, expect } from '@playwright/test';
test('设备部件分解与剖视稳定渲染', async ({ page, request }) => {
  await login(page, request);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: '设备监测 EQUIPMENT' }).click();
  await expect(page.getByTestId('equipment-canvas').locator('canvas')).toBeVisible({
    timeout: 45000,
  });
  await expect(page.locator('.scene-loading')).toHaveCount(0, { timeout: 45000 });
  await page.getByRole('button', { name: '分解视图', exact: true }).click();
  await page.getByRole('button', { name: '内部剖视', exact: true }).click();
  await page.getByRole('button', { name: '铜排母线', exact: true }).click();
  await expect(page.locator('.component-detail>b')).toHaveText('铜排母线');
  await page.screenshot({ path: 'docs/equipment.png', timeout: 15000 });
  await expect(page.locator('.scene-error')).toHaveCount(0);
  expect(errors).toEqual([]);
});
