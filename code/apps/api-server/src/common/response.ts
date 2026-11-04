import type { ApiResponse } from '@innodl/power-types';
/** 创建统一成功响应。
 * @param data 类型化业务实体。
 * @param requestId 请求追踪标识。
 * @returns 包含业务数据、演示标记和追踪标识的封装。
 */
export function response<T>(data: T, requestId: string): ApiResponse<T> {
  return { code: 'OK', message: 'success', data, isDemoData: true, requestId };
}
