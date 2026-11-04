import type { SessionUser } from '@innodl/power-types';
/** 请求生命周期内的认证上下文，弱引用避免请求对象泄漏。 */
export const authenticatedUsers = new WeakMap<object, SessionUser>();
