import { resolveModelBindings } from '../models/bindings';
import { isAssetVisible } from '../layers/visibility';
import { createDisposer } from '../core/lifecycle';
import { resolveBusinessId } from '../interactions/pick';
import { colors } from '../effects/voltage-colors';
import * as C from 'cesium';
import { type SceneMode } from '@innodl/power-types';
import { assetStatus, lineStatus } from '@innodl/shared-utils';
import type { EngineBindings } from '../bindings/types';
import 'cesium/Build/Cesium/Widgets/widgets.css';
const origin = C.Cartesian3.fromDegrees(121.302, 31.188);
const frame = C.Transforms.eastNorthUpToFixedFrame(origin);
/** 将场馆 ENU 米制坐标变换到 WGS84 世界坐标。
 * @param x 东向距离，单位米。
 * @param y 北向距离，单位米。
 * @param z 离地高度，单位米。
 * @returns Cesium 世界笛卡尔坐标。
 */
function world(x: number, y: number, z = 0): C.Cartesian3 {
  return C.Matrix4.multiplyByPoint(frame, new C.Cartesian3(x, y, z), new C.Cartesian3());
}
/** 创建城市演示底座与独立图层，所有几何在本地生成。
 * @param container Canvas 容器元素。
 * @param onReady 场景资源加载完成回调。
 * @param onError 三维加载异常回调。
 * @param bindings 从业务层注入的状态读取与选择事件。
 * @returns 场景实例、视角切换函数、图层同步函数及销毁函数。
 */
export function createCity(
  container: HTMLElement,
  onReady: () => void,
  onError: (message: string) => void,
  bindings: EngineBindings,
) {
  const { assets, lines } = bindings.getState().catalog;
  const viewer = new C.Viewer(container, {
    baseLayer: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    skyBox: false,
    skyAtmosphere: false,
    requestRenderMode: true,
    maximumRenderTimeChange: Infinity,
    contextOptions: { webgl: { alpha: false, antialias: true } },
  });
  viewer.scene.backgroundColor = C.Color.fromCssColorString('#081d2b');
  viewer.scene.globe.baseColor = C.Color.fromCssColorString('#091b26');
  viewer.scene.globe.showGroundAtmosphere = false;
  viewer.scene.fog.enabled = false;
  if (viewer.scene.sun) viewer.scene.sun.show = false;
  if (viewer.scene.moon) viewer.scene.moon.show = false;
  viewer.scene.light = new C.DirectionalLight({
    direction: new C.Cartesian3(-0.4, 0.4, -1),
    intensity: 2,
  });
  viewer.resolutionScale = Math.min(window.devicePixelRatio, 1.5);
  viewer.scene.screenSpaceCameraController.minimumZoomDistance = 220;
  viewer.scene.screenSpaceCameraController.maximumZoomDistance = 45000;
  viewer.scene.screenSpaceCameraController.enableCollisionDetection = false;
  const buildings = new C.CustomDataSource('buildings');
  const networks = new C.CustomDataSource('networks');
  const pois = new C.CustomDataSource('pois');
  const boundary = new C.CustomDataSource('boundary');
  [buildings, networks, pois, boundary].forEach((source) => viewer.dataSources.add(source));
  // 固定伪随机种子保证每次运行城市布局一致。
  let seed = 841;
  /** 生成固定种子的随机值。
   * @returns 0 到 1 的伪随机数。
   */
  function random(): number {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  }
  const instances: C.GeometryInstance[] = [];
  for (let i = 0; i < 3400; i++) {
    const x = (random() - 0.5) * 17000;
    const y = (random() - 0.5) * 13000;
    if (
      (Math.abs(x) < 660 && Math.abs(y) < 660) ||
      Math.abs(x - (2100 + Math.sin(y / 1800) * 900)) < 200
    )
      continue;
    const dx = Math.round(x / 135) * 135;
    const dy = Math.round(y / 135) * 135;
    const height = 15 + random() ** 3 * 260;
    const matrix = C.Transforms.eastNorthUpToFixedFrame(world(dx, dy, height / 2));
    instances.push(
      new C.GeometryInstance({
        geometry: C.BoxGeometry.fromDimensions({
          dimensions: new C.Cartesian3(35 + random() * 65, 35 + random() * 65, height),
          vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT,
        }),
        modelMatrix: matrix,
        attributes: {
          color: C.ColorGeometryInstanceAttribute.fromColor(
            C.Color.fromCssColorString(i % 5 ? '#24424d' : '#41616a'),
          ),
        },
      }),
    );
  }
  const city = viewer.scene.primitives.add(
    new C.Primitive({
      geometryInstances: instances,
      appearance: new C.PerInstanceColorAppearance({ closed: true, translucent: false }),
      asynchronous: false,
    }),
  );
  for (let i = -20; i <= 20; i++) {
    const p = i * 370;
    buildings.entities.add({
      polyline: {
        positions: [world(p, -7000, 1), world(p, 7000, 1)],
        width: i % 5 === 0 ? 2 : 1,
        material: C.Color.fromCssColorString(i % 5 === 0 ? '#2a6874' : '#1a3542'),
      },
    });
    buildings.entities.add({
      polyline: {
        positions: [world(-9000, p, 1), world(9000, p, 1)],
        width: i % 5 === 0 ? 2 : 1,
        material: C.Color.fromCssColorString('#254854'),
      },
    });
  }
  const river = Array.from({ length: 60 }, (_, i) =>
    world(2100 + Math.sin((i - 30) / 8) * 900, (i - 30) * 270, 2),
  );
  buildings.entities.add({
    polyline: { positions: river, width: 55, material: C.Color.fromCssColorString('#10414e') },
  });
  const ring = [
    world(-610, -610, 8),
    world(610, -610, 8),
    world(610, 610, 8),
    world(-610, 610, 8),
    world(-610, -610, 8),
  ];
  boundary.entities.add({
    polygon: {
      hierarchy: new C.PolygonHierarchy(ring),
      material: C.Color.fromCssColorString('#26e6a0').withAlpha(0.08),
      perPositionHeight: true,
    },
    polyline: {
      positions: ring,
      width: 5,
      material: new C.PolylineGlowMaterialProperty({
        glowPower: 0.25,
        color: C.Color.fromCssColorString('#26e6a0'),
      }),
    },
    wall: {
      positions: ring,
      minimumHeights: ring.map(() => 5),
      maximumHeights: ring.map(() => 70),
      material: C.Color.fromCssColorString('#26e6a0').withAlpha(0.12),
    },
  });
  const entityMap = new Map<string, C.Entity>();
  const lineMap = new Map<string, C.Entity>();
  for (const asset of assets) {
    const pos = C.Cartesian3.fromDegrees(...asset.position);
    const entity = pois.entities.add({
      id: asset.id,
      position: pos,
      point: {
        pixelSize: 9,
        color: C.Color.fromCssColorString('#26e6a0'),
        outlineColor: C.Color.fromCssColorString('#123d43'),
        outlineWidth: 5,
        disableDepthTestDistance: Infinity,
      },
      label: {
        text: asset.name,
        font: '13px sans-serif',
        fillColor: C.Color.fromCssColorString('#c5f7ee'),
        showBackground: true,
        backgroundColor: C.Color.fromCssColorString('#0a2836').withAlpha(0.9),
        backgroundPadding: new C.Cartesian2(12, 8),
        pixelOffset: new C.Cartesian2(0, -42),
        verticalOrigin: C.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Infinity,
        distanceDisplayCondition: new C.DistanceDisplayCondition(0, 55000),
      },
      polyline: {
        positions: [pos, C.Cartesian3.fromDegrees(asset.position[0], asset.position[1], 160)],
        width: 1,
        material: C.Color.fromCssColorString('#26e6a0').withAlpha(0.6),
      },
    });
    entityMap.set(asset.id, entity);
    if (asset.type === 'substation')
      buildings.entities.add({
        position: C.Cartesian3.fromDegrees(asset.position[0], asset.position[1], 25),
        box: {
          dimensions: new C.Cartesian3(90, 65, 45),
          material: C.Color.fromCssColorString('#287c86'),
          outline: true,
          outlineColor: C.Color.CYAN,
        },
      });
  }
  for (const line of lines) {
    const a = assets.find((asset) => asset.id === line.fromId)!;
    const b = assets.find((asset) => asset.id === line.toId)!;
    const coords = [a.position, [a.position[0], b.position[1], 35], b.position] as [
      number,
      number,
      number,
    ][];
    const entity = networks.entities.add({
      id: line.id,
      polyline: {
        positions: coords.map((p) => C.Cartesian3.fromDegrees(p[0], p[1], 45)),
        width: 3,
        material: new C.PolylineGlowMaterialProperty({
          glowPower: 0.18,
          color: C.Color.fromCssColorString(colors[line.voltage]),
        }),
      },
    });
    lineMap.set(line.id, entity);
    networks.entities.add({
      id: `flow-${line.id}`,
      position: new C.CallbackPositionProperty(() => {
        const t = (performance.now() / 4200) % 1;
        const start = C.Cartesian3.fromDegrees(a.position[0], a.position[1], 50);
        const middle = C.Cartesian3.fromDegrees(a.position[0], b.position[1], 50);
        const end = C.Cartesian3.fromDegrees(b.position[0], b.position[1], 50);
        return t < 0.5
          ? C.Cartesian3.lerp(start, middle, t * 2, new C.Cartesian3())
          : C.Cartesian3.lerp(middle, end, (t - 0.5) * 2, new C.Cartesian3());
      }, false),
      point: { pixelSize: 5, color: C.Color.WHITE },
    });
  }
  const modelBindings = resolveModelBindings(bindings.getState().catalog);
  const modelEntities = modelBindings.flatMap((binding) => {
    const asset = assets.find((item) => item.id === binding.assetId);
    if (!asset) return [];
    return [
      viewer.entities.add({
        id: `model-${binding.assetId}`,
        position: C.Cartesian3.fromDegrees(
          asset.position[0],
          asset.position[1],
          binding.transform.height ?? 0,
        ),
        model: {
          uri: binding.modelUri,
          scale: binding.transform.scale ?? 1,
          minimumPixelSize: 100,
          color: C.Color.fromCssColorString('#c3ffef'),
          shadows: C.ShadowMode.DISABLED,
        },
      }),
    ];
  });
  viewer.scene.globe.depthTestAgainstTerrain = false;
  /** 飞向场景书签，保留同一 Viewer。
   * @param mode 当前场景模式。
   * @param instant 是否直接定位，用于首次渲染。
   * @returns 无返回值，驱动相机镜头动画。
   */
  function fly(mode: SceneMode, instant = false) {
    const radius = mode === 'venue' ? 1750 : mode === 'grid' ? 10000 : 13000;
    viewer.camera.flyToBoundingSphere(new C.BoundingSphere(origin, radius), {
      duration: instant ? 0 : 1.8,
      offset: new C.HeadingPitchRange(
        C.Math.toRadians(mode === 'venue' ? 15 : 5),
        C.Math.toRadians(-48),
        radius * 2,
      ),
    });
  }
  /** 同步筛选、实时状态和选中态。
   * @returns 无返回值，更新已有实体而不重建场景。
   */
  function sync() {
    const state = bindings.getState();
    const telemetry = state.telemetry;
    city.show = state.buildings;
    buildings.show = state.buildings;
    boundary.show = state.boundary;
    for (const asset of assets) {
      const entity = entityMap.get(asset.id)!;
      entity.show = isAssetVisible(asset, state);
      entity.label!.show = new C.ConstantProperty(state.labels);
      entity.point!.color = new C.ConstantProperty(
        C.Color.fromCssColorString(
          assetStatus(asset.id, telemetry) === 'normal' ? '#26e6a0' : '#f8bf58',
        ),
      );
      entity.point!.pixelSize = new C.ConstantProperty(state.selected === asset.id ? 15 : 8);
    }
    for (const line of lines) {
      const entity = lineMap.get(line.id)!;
      const a = entityMap.get(line.fromId)!;
      const b = entityMap.get(line.toId)!;
      entity.show = state.voltages.includes(line.voltage) && a.show && b.show;
      networks.entities.getById(`flow-${line.id}`)!.show = entity.show;
      entity.polyline!.width = new C.ConstantProperty(state.selected === line.id ? 7 : 3);
      entity.polyline!.material = new C.PolylineGlowMaterialProperty({
        color: C.Color.fromCssColorString(
          lineStatus(line, telemetry) === 'normal' ? colors[line.voltage] : '#f8bf58',
        ),
        glowPower: 0.22,
      });
    }
    modelEntities.forEach((entity) => {
      const asset = assets.find((item) => `model-${item.id}` === entity.id);
      entity.show =
        !!asset &&
        (!state.category || state.category === asset.type) &&
        (!state.protectedIds || state.protectedIds.includes(asset.id));
    });
    viewer.scene.requestRender();
  }
  const handler = new C.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((event: { position: C.Cartesian2 }) => {
    const picked = viewer.scene.pick(event.position);
    if (picked?.id instanceof C.Entity) {
      const id = picked.id.id === 'venue-model' ? 'venue' : picked.id.id;
      if (resolveBusinessId(id, new Set([...assets, ...lines].map((item) => item.id))))
        bindings.select(id);
    }
  }, C.ScreenSpaceEventType.LEFT_CLICK);
  const removeError = viewer.scene.renderError.addEventListener((_scene, error) =>
    onError(String(error)),
  );
  fly('venue', true);
  sync();
  onReady();
  return {
    viewer,
    fly,
    sync,
    /** 释放 Viewer、事件监听和 GPU 资源。
     * @returns 无返回值，容器可安全卸载。
     */
    destroy: createDisposer([() => viewer.destroy(), () => handler.destroy(), removeError]),
  };
}
