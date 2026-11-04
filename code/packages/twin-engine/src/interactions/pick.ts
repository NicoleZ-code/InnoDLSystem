/** 将引擎拾取结果限制为业务资产或线路。
 * @param id 引擎实体标识。
 * @param validIds 已加载业务标识集合。
 * @returns 可用于页面联动的业务 ID，非业务对象返回 null。
 */
export function resolveBusinessId(id: unknown, validIds: Set<string>): string | null {
  return typeof id === 'string' && validIds.has(id) ? id : null;
}
