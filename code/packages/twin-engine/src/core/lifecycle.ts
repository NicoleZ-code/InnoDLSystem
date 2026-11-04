/** 管理场景清理操作，重复销毁保持幂等。
 * @param disposers 需要按逆序释放的资源清理函数。
 * @returns 可安全重复调用的销毁函数。
 */
export function createDisposer(disposers: (() => void)[]) {
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    for (const dispose of [...disposers].reverse()) dispose();
  };
}
