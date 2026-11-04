import type { Page, APIRequestContext } from '@playwright/test';
/** 为测试浏览器创建真实认证会话，使用隔离测试服务。
 * @param page 当前测试页面。
 * @param request 测试 HTTP 客户端。
 * @returns 可用于验证受保护 API 的 Authorization 请求头。
 */
export async function login(page: Page, request: APIRequestContext) {
  const response = await request.post('http://127.0.0.1:8790/api/v1/auth/login', {
    data: { username: 'admin', password: 'E2E-Only-InnoDL-2026!' },
  });
  const token = (await response.json()).data.token;
  await page.addInitScript((value) => sessionStorage.setItem('innodl-token', value), token);
  return { authorization: `Bearer ${token}` };
}
