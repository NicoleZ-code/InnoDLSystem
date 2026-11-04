import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';

import { telemetryAt } from '@innodl/shared-utils';
import { useStore } from '../stores/scene.store';
import { fetchReplay, fetchScene, request, subscribeScene } from '../api/client';
const offline = import.meta.env.VITE_DATA_MODE === 'offline';
/** 加载权威场景目录并订阅服务端更新，只有明确离线模式才使用本地演示。
 * @returns 场景查询状态，失败时保留可重试错误。
 */
export function useSceneData() {
  const query = useQuery({
    queryKey: ['scene-assets'],
    queryFn: () => (offline ? Promise.resolve(useStore.getState().catalog) : fetchScene()),
    staleTime: Infinity,
    retry: 1,
  });
  useEffect(() => {
    if (query.data) useStore.getState().set({ catalog: query.data });
  }, [query.data]);
  useEffect(() => {
    if (offline) {
      useStore.getState().set({ connection: 'offline' });
      return;
    }
    const abort = new AbortController();
    request<{ telemetry: ReturnType<typeof telemetryAt> }>('/api/simulation', {
      signal: abort.signal,
    })
      .then(({ telemetry }) => useStore.getState().set({ telemetry, tick: telemetry.tick }))
      .catch((error) => {
        if (!abort.signal.aborted) useStore.getState().set({ dataError: String(error) });
      });
    const unsubscribe = subscribeScene(
      (event) => {
        const state = useStore.getState();
        if (event.type === 'domain') {
          if (event.event === 'alarm.created' && state.playing) {
            const alarm = event.data as { assetId: string };
            state.set({ selected: alarm.assetId, mode: 'venue' });
          }
          return;
        }
        if (event.type === 'catalog') state.set({ catalog: event.data });
        else if (state.playing)
          state.set({ telemetry: event.data, tick: event.data.tick, dataError: '' });
      },
      (connected) => useStore.getState().set({ connection: connected ? 'online' : 'error' }),
    );
    return () => {
      abort.abort();
      unsubscribe();
    };
  }, []);
  return query;
}
/** 统一快照驱动所有视图，暂停只影响当前浏览器，回放由服务端计算。
 * @returns 最新有效的完整遥测对象。
 */
export function useSimulation() {
  const tick = useStore((state) => state.tick);
  const playing = useStore((state) => state.playing);
  const telemetry = useStore((state) => state.telemetry);
  useEffect(() => {
    if (!offline || !playing) return;
    const timer = window.setInterval(() => {
      const state = useStore.getState();
      const next = state.tick + 1;
      state.set({ tick: next, telemetry: telemetryAt(next) });
    }, 1000);
    return () => clearInterval(timer);
  }, [playing]);
  useEffect(() => {
    if (playing || tick === telemetry.tick) return;
    if (offline) {
      useStore.getState().set({ telemetry: telemetryAt(tick) });
      return;
    }
    const abort = new AbortController();
    fetchReplay(tick, abort.signal)
      .then((snapshot) => useStore.getState().set({ telemetry: snapshot, dataError: '' }))
      .catch((error) => {
        if (!abort.signal.aborted) useStore.getState().set({ dataError: String(error) });
      });
    return () => abort.abort();
  }, [tick, playing, telemetry.tick]);
  useEffect(() => {
    const state = useStore.getState();
    if (state.tour && tick % 12 === 0) {
      const modes = ['city', 'grid', 'venue', 'equipment'] as const;
      state.set({ mode: modes[Math.floor(tick / 12) % 4], selected: 'venue' });
    }
  }, [tick]);
  return telemetry;
}
