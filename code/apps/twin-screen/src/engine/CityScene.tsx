import { useEffect, useRef, useState } from 'react';
import { captureCamera, restoreCamera } from '@innodl/twin-engine';
import { HeadingPitchRange } from 'cesium';
import { createCity } from './city';
import { useStore } from '../stores/scene.store';
/** Cesium 生命周期边界，业务状态通过订阅同步。
 * @returns 全屏三维城市与可恢复的加载状态。
 */
export default function CityScene() {
  const container = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!container.current) return;
    let scene: ReturnType<typeof createCity> | undefined;
    try {
      scene = createCity(container.current, () => setLoading(false), setError, {
        getState: useStore.getState,
        select: (id) => useStore.getState().select(id),
      });
    } catch (cause) {
      setError(String(cause));
      setLoading(false);
    }
    if (!scene) return;
    const previousCamera = useStore.getState().camera;
    if (previousCamera) restoreCamera(scene.viewer, previousCamera);
    else {
      scene.fly(useStore.getState().mode, true);
      const asset = useStore
        .getState()
        .catalog.assets.find((item) => item.id === useStore.getState().selected);
      if (asset && asset.id !== 'venue')
        void scene.viewer.flyTo(
          scene.viewer.dataSources.getByName('pois')[0].entities.getById(asset.id)!,
          { duration: 0, offset: new HeadingPitchRange(0.2, -0.85, 1800) },
        );
    }
    const unsubscribe = useStore.subscribe((state, previous) => {
      scene!.sync();
      if (
        state.mode !== previous.mode ||
        state.region !== previous.region ||
        state.revision !== previous.revision
      )
        scene!.fly(state.mode);
      if (state.selected !== previous.selected && state.mode !== 'equipment') {
        const sourceName = state.selected.startsWith('line-') ? 'networks' : 'pois';
        const entity = scene!.viewer.dataSources
          .getByName(sourceName)[0]
          ?.entities.getById(state.selected);
        if (state.selected === 'venue') scene!.fly('venue');
        else if (entity)
          void scene!.viewer.flyTo(entity, {
            duration: 1.5,
            offset: new HeadingPitchRange(0.2, -0.85, 1800),
          });
      }
    });
    return () => {
      unsubscribe();
      useStore.getState().set({ camera: captureCamera(scene!.viewer) });
      scene!.destroy();
    };
  }, []);
  return (
    <>
      <div
        className="city-canvas"
        ref={container}
        data-testid="city-canvas"
      />
      {loading && (
        <div className="scene-loading">
          <span className="spinner" />
          正在构建城市数字底座…
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="scene-error"
        >
          三维场景加载失败：{error}
          <button onClick={() => window.location.reload()}>重新加载</button>
        </div>
      )}
    </>
  );
}
