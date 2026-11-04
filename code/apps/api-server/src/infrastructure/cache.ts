import { createClient } from 'redis';
/** 建立可选的 Redis 最新值和事件缓存，数据库仍为业务真值。
 * @param url Redis 连接地址；未配置时返回空适配器并明确由调用者报告降级。
 * @returns 支持缓存写入、事件分发和关闭的资源对象，或 undefined。
 */
export async function createCache(url?: string) {
  if (!url) return undefined;
  const client = createClient({ url, socket: { connectTimeout: 5000, reconnectStrategy: false } });
  client.on('error', () => {
    /* 业务写入失败由调用处记录，防止未捕获 error 事件。 */
  });
  await client.connect();
  return {
    /** 缓存最新采样并发布跨实例事件。
     * @param event 消息类型。
     * @param data 事件有效载荷。
     * @returns 完成缓存与事件写入的 Promise。
     */
    async publish(event: string, data: unknown) {
      if (event === 'telemetry.batch' && Array.isArray(data)) {
        const batch = client.multi();
        for (const point of data)
          batch.set(`telemetry:latest:${point.pointId}`, JSON.stringify(point), { EX: 30 });
        await batch.exec();
      }
      await client.publish('innodl:events', JSON.stringify({ event, data, timestamp: Date.now() }));
    },
    /** 关闭 Redis 连接。
     * @returns 资源关闭完成的 Promise。
     */
    async close() {
      await client.quit();
    },
  };
}
