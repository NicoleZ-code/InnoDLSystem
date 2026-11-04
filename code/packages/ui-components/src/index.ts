/** 将连接状态映射为可供任一前端复用的展示信息。
 * @param connected 是否已经连接实时通道。
 * @returns 文案和状态色。
 */
export function connectionPresentation(connected: boolean) {
  return {
    label: connected ? '实时链路在线' : '连接待恢复',
    color: connected ? '#16a085' : '#d89614',
  };
}
