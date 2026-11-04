import { login } from './auth';
import { test, expect } from '@playwright/test';
test('维护窗口保存资产，刷新后读取数据库并可删除', async ({ page, request }) => {
  const auth = await login(page, request);
  test.setTimeout(180000);
  const id = `e2e-station-${Date.now()}`;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '数据维护', exact: true }).click({ timeout: 45000 });
    await expect(page.getByRole('dialog', { name: '保障数据维护' })).toBeVisible();
    await page.getByRole('textbox', { name: '资源唯一标识' }).fill(id);
    await page.getByRole('textbox', { name: '资源名称' }).fill('前后端联调测试站');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('数据已保存至后端', { timeout: 30000 });
    await page.getByRole('button', { name: '关闭数据维护' }).click();
    await page.reload();
    await page.getByRole('button', { name: '数据维护', exact: true }).click({ timeout: 45000 });
    await expect(page.locator('.operations-list')).toContainText('前后端联调测试站');
    await page
      .locator('.operations-list')
      .getByRole('button', { name: new RegExp(id) })
      .click();
    await page.getByRole('textbox', { name: '资源名称' }).fill('更新后的联调测试站');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('数据已保存至后端', { timeout: 30000 });
    const response = await request.get(`/api/assets/${id}`, { headers: auth });
    expect(response.status()).toBe(200);
    expect((await response.json()).data.name).toBe('更新后的联调测试站');
    await page.getByRole('button', { name: '删除元数据' }).click();
    await expect
      .poll(async () => (await request.get(`/api/assets/${id}`, { headers: auth })).status())
      .toBe(404);
    expect(errors).toEqual([]);
  } finally {
    await request.delete(`/api/assets/${id}`, { headers: auth });
  }
});
