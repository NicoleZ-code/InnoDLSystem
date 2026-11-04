import { overviewRoute } from '../pages/overview/route';
import { stationRoute } from '../pages/station/route';
import { deviceRoute } from '../pages/device/route';
import { protectionRoute } from '../pages/protection/route';
import { alarmsRoute } from '../pages/alarms/route';
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { request } from '@innodl/api-client';
import type { ProtectionEvent, SceneMode } from '@innodl/power-types';
import { useStore } from '../stores/scene.store';
/** 将可分享的三维地址映射到业务选择，场景容器持续复用。
 * @returns 页面模式切换函数，调用后同步地址和业务状态。
 */
export function useTwinRoute() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const [, prefix, page, id] = pathname.split('/');
    if (prefix !== 'twin') {
      navigate(overviewRoute.path, { replace: true });
      return;
    }
    const state = useStore.getState();
    const patch = {
      topology: page === 'topology',
      protectedIds: undefined as string[] | undefined,
    };
    if (page === protectionRoute.path.split('/').pop() && id) {
      const abort = new AbortController();
      request<ProtectionEvent>(`/api/protection-events/${encodeURIComponent(id)}`, {
        signal: abort.signal,
      })
        .then((event) =>
          state.set({
            ...patch,
            mode: 'venue',
            protectedIds: event.assetIds,
            selected: event.assetIds[0] ?? 'venue',
          }),
        )
        .catch((error) => {
          if (!abort.signal.aborted) state.set({ dataError: String(error) });
        });
      return () => abort.abort();
    }
    if (page === 'area' && id) state.set({ ...patch, mode: 'city', region: id });
    else if (page === stationRoute.path.split('/').pop() && id)
      state.set({ ...patch, mode: 'venue', selected: id });
    else if (page === deviceRoute.path.split('/').pop() && id)
      state.set({ ...patch, mode: 'equipment', selected: id });
    else
      state.set({
        ...patch,
        mode:
          page === 'topology'
            ? 'grid'
            : page === 'overview'
              ? overviewRoute.mode
              : page === 'alarms'
                ? alarmsRoute.mode
                : state.mode,
        playing: page !== 'replay',
      });
  }, [pathname, navigate]);
  /** 切换具名场景并生成可直接访问的地址。
   * @param mode 用户选择的场景模式。
   * @returns 无返回值，更新导航与页面状态。
   */
  function changeMode(mode: SceneMode) {
    useStore.getState().set({ mode, tour: false, category: undefined });
    const selected = useStore.getState().selected;
    navigate(
      mode === 'city'
        ? '/twin/overview'
        : mode === 'grid'
          ? '/twin/topology'
          : mode === 'equipment'
            ? `/twin/device/${selected}`
            : `/twin/station/${selected}`,
    );
  }
  return changeMode;
}
