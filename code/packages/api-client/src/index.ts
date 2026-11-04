import type {
  ApiResponse,
  SceneCatalog,
  ServerEvent,
  Telemetry,
  Asset,
  PowerLine,
  AlarmRecord,
  AuditEntry,
} from '@innodl/power-types';
let refreshing: Promise<string> | undefined;
/** 用 HttpOnly 刷新 Cookie 轮换短期访问令牌。
 * @returns 新的 Access Token，失败时清除失效令牌并抛错。
 */
export function refreshSession(): Promise<string> {
  if (!refreshing)
    refreshing = fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' })
      .then(async (response) => {
        const envelope = await response.json();
        if (!response.ok) {
          sessionStorage.removeItem('innodl-token');
          throw new Error(envelope.error?.message ?? '请先登录');
        }
        sessionStorage.setItem('innodl-token', envelope.data.token);
        return envelope.data.token as string;
      })
      .finally(() => {
        refreshing = undefined;
      });
  return refreshing;
}
/** 发送统一 API 请求并最多执行一次会话刷新。
 * @param path API 路径。
 * @param options 请求方法、请求体和取消信号。
 * @param allowRefresh 是否允许本次请求刷新令牌。
 * @param preservePage 是否保留分页结构。
 * @returns 已解包的业务数据。
 */
async function send<T>(
  path: string,
  options: RequestInit,
  allowRefresh: boolean,
  preservePage = false,
): Promise<T> {
  const token = sessionStorage.getItem('innodl-token');
  const url = path.startsWith('/api/v1/') ? path : path.replace(/^\/api\//, '/api/v1/');
  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  if (
    response.status === 401 &&
    allowRefresh &&
    !/\/auth\/(login|refresh)/.test(url) &&
    !options.signal?.aborted
  ) {
    await refreshSession();
    return send<T>(path, options, false, preservePage);
  }
  const envelope = await response.json();
  if (!response.ok)
    throw new Error(envelope.error?.message ?? envelope.message ?? `接口异常：${response.status}`);
  const data = (envelope as ApiResponse<T>).data;
  return (
    !preservePage && data && typeof data === 'object' && 'items' in data ? data.items : data
  ) as T;
}
/** 发送同源 API 请求，列表自动解包 items。
 * @param path API 相对路径。
 * @param options HTTP 方法、请求体和取消信号。
 * @returns 类型化业务数据或列表项数组。
 */
export function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  return send<T>(path, options, true);
}
/** 读取完整分页响应。
 * @param path 包含 page 和 pageSize 的资源地址。
 * @returns 列表、总数和分页参数。
 */
export function requestPage<T>(
  path: string,
): Promise<{ items: T[]; total: number; page: number; pageSize: number }> {
  return send(path, {}, true, true);
}
/** 获取后端完整场景目录。
 * @returns 服务端提供的资产、线路、区域和修订号。
 */
export function fetchScene(): Promise<SceneCatalog> {
  return request('/api/catalog/shanghai');
}
/** 获取指定 tick 的服务端回放，保持公共实时模拟器不变。
 * @param tick 回放秒数。
 * @param signal 可选取消信号，避免快速拖动时旧响应覆盖新响应。
 * @returns 对应时刻的完整遥测。
 */
export function fetchReplay(tick: number, signal?: AbortSignal): Promise<Telemetry> {
  return request(`/api/telemetry/replay?tick=${tick}`, { signal });
}
/** 自动重连实时事件通道，连接中断时明确报告状态。
 * @param onEvent 接收完整遥测或目录更新的回调。
 * @param onStatus 连接是否已建立的回调。
 * @returns 关闭连接、重连计时器与所有监听的清理函数。
 */
export function subscribeScene(
  onEvent: (event: ServerEvent) => void,
  onStatus: (connected: boolean) => void,
): () => void {
  let socket: WebSocket | undefined;
  let timer: number | undefined;
  let disposed = false;
  let retry = 0;
  /** 创建一次 WebSocket 连接并安排指数退避重连。
   * @returns 无返回值，连接事件驱动后续生命周期。
   */
  function connect() {
    if (disposed) return;
    const url = new URL('/ws/scene-events', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(url);
    let lastSequence = 0;
    let lastMessage = Date.now();
    socket.onopen = () => {
      retry = 0;
      const token = sessionStorage.getItem('innodl-token');
      socket?.send(JSON.stringify({ event: 'auth', token }));
      socket?.send(JSON.stringify({ event: 'telemetry.subscribe', assetIds: [] }));
      void request('/api/simulation')
        .then((data) => {
          if (data && !disposed)
            onEvent({
              type: 'telemetry',
              data: (data as { telemetry: Telemetry }).telemetry,
              simulation: (data as { simulation: { playing: boolean; tick: number } }).simulation,
              isDemoData: true,
            });
        })
        .catch(() => onStatus(false));
      onStatus(true);
    };
    socket.onmessage = (message) => {
      lastMessage = Date.now();
      try {
        const event = JSON.parse(message.data) as ServerEvent;
        if (event.type === 'domain') {
          if (event.seq <= lastSequence) return;
          lastSequence = event.seq;
        }
        if (
          event.type === 'domain' ||
          event.type === 'catalog' ||
          (event.type === 'telemetry' && Number.isInteger(event.data.tick))
        )
          onEvent(event);
      } catch {
        /* 忽略无效消息，等待下一有效快照。 */
      }
    };
    const stale = window.setInterval(() => {
      if (Date.now() - lastMessage > 45000) socket?.close();
    }, 15000);
    socket.onerror = () => onStatus(false);
    socket.onclose = () => {
      clearInterval(stale);
      if (disposed) return;
      onStatus(false);
      timer = window.setTimeout(connect, Math.min(1000 * 2 ** retry++, 15000));
    };
  }
  const watchdog = window.setInterval(() => {
    if (socket?.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify({ event: 'system.heartbeat' }));
  }, 15000);
  connect();
  return () => {
    clearInterval(watchdog);
    disposed = true;
    clearTimeout(timer);
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      // 保留 onclose，负责清理连接级超时检测器。
      socket.close();
    }
  };
}
/** 保存资产元数据。
 * @param asset 完整资产信息。
 * @param create 是否创建新资产。
 * @returns 已保存的资产。
 */
export function saveAsset(asset: Asset, create: boolean) {
  return request<Asset>(create ? '/api/assets' : `/api/assets/${asset.id}`, {
    method: create ? 'POST' : 'PUT',
    body: JSON.stringify(asset),
  });
}
/** 保存供电线路元数据。
 * @param line 线路与端点关系。
 * @param create 是否创建新线路。
 * @returns 已保存的线路。
 */
export function saveLine(line: PowerLine, create: boolean) {
  return request<PowerLine>(create ? '/api/power-lines' : `/api/power-lines/${line.id}`, {
    method: create ? 'POST' : 'PUT',
    body: JSON.stringify(line),
  });
}
/** 删除资产或线路元数据。
 * @param kind 资源种类。
 * @param id 资源唯一标识。
 * @returns 删除成功的资源 ID。
 */
export function deleteResource(kind: 'assets' | 'power-lines', id: string) {
  return request<{ deleted: string }>(`/api/${kind}/${id}`, { method: 'DELETE' });
}
/** 查询告警处理记录。
 * @returns 包括已恢复告警的处理列表。
 */
export function fetchAlarms() {
  return request<AlarmRecord[]>('/api/alarms');
}
/** 确认告警并记录处理说明。
 * @param id 告警标识。
 * @param note 处理备注。
 * @returns 已保存的告警确认记录。
 */
export function acknowledgeAlarm(id: string, note: string) {
  return request<AlarmRecord>(`/api/alarms/${id}/acknowledge`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });
}
/** 查询最近操作审计。
 * @returns 最近 50 条操作记录。
 */
export function fetchAudit() {
  return request<AuditEntry[]>('/api/audit');
}
