import { useEffect, useRef, useState } from 'react';
import * as T from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useStore } from '../stores/scene.store';
/** Three.js 独立设备场景，支持部件拾取、剖视与分解。
 * @returns 设备 Canvas、载入进度与错误提示。
 */
export default function EquipmentScene() {
  const container = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!container.current) return;
    const host = container.current;
    const scene = new T.Scene();
    scene.background = new T.Color('#081d2b');
    scene.fog = new T.Fog('#081d2b', 14, 40);
    const renderer = new T.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
    renderer.localClippingEnabled = true;
    host.appendChild(renderer.domElement);
    const camera = new T.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(7, 5, 10);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1, 0);
    controls.enableDamping = true;
    controls.minDistance = 4;
    controls.maxDistance = 22;
    scene.add(new T.HemisphereLight('#b4fff3', '#071526', 2.7));
    const key = new T.DirectionalLight('#b2e8ff', 4);
    key.position.set(3, 8, 5);
    scene.add(key);
    const grid = new T.GridHelper(60, 60, '#215c66', '#102f3e');
    scene.add(grid);
    let model: T.Group | undefined;
    let alive = true;
    const initial = new Map<string, T.Vector3>();
    new GLTFLoader().load(
      '/models/switchgear.glb',
      (gltf) => {
        if (!alive) {
          disposeObject(gltf.scene);
          return;
        }
        model = gltf.scene;
        model.traverse((obj) => {
          initial.set(obj.uuid, obj.position.clone());
          if (obj instanceof T.Mesh) {
            obj.material = (obj.material as T.MeshStandardMaterial).clone();
            const edge = new T.LineSegments(
              new T.EdgesGeometry(obj.geometry),
              new T.LineBasicMaterial({ color: '#418a92', transparent: true, opacity: 0.35 }),
            );
            obj.add(edge);
          }
        });
        scene.add(model);
        setLoading(false);
      },
      undefined,
      (cause) => {
        if (alive) {
          setError(String(cause));
          setLoading(false);
        }
      },
    );
    const ray = new T.Raycaster();
    const pointer = new T.Vector2();
    /** 从屏幕坐标拾取柜体部件。
     * @param event 鼠标释放事件。
     * @returns 无返回值，将部件标识写入共享状态。
     */
    function pick(event: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      ray.setFromCamera(pointer, camera);
      if (!model) return;
      const hit = ray
        .intersectObject(model, true)
        .find((item) => item.object instanceof T.Mesh && item.object.visible);
      if (hit) useStore.getState().set({ component: hit.object.name.split('-')[0] });
    }
    renderer.domElement.addEventListener('pointerup', pick);
    const observer = new ResizeObserver(() => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    });
    observer.observe(host);
    let frame = 0;
    /** 更新设备分解与剖切状态并渲染。
     * @returns 无返回值，安排下一动画帧。
     */
    function animate() {
      frame = requestAnimationFrame(animate);
      const state = useStore.getState();
      model?.traverse((obj) => {
        if (!(obj instanceof T.Mesh)) return;
        const base = initial.get(obj.uuid)!;
        const kind = obj.name.split('-')[0];
        const index = Number.parseInt(obj.name.split('-')[1] ?? '0', 10);
        const target = base.clone();
        if (state.exploded) {
          target.x += (index - 1.5) * 0.38;
          if (kind === 'door' || kind === 'meter' || kind === 'handle') target.z += 1.4;
          if (kind === 'busbar') target.y += 0.8;
        }
        obj.position.lerp(target, 0.1);
        obj.visible = !(state.cutaway && ['cabinet', 'door', 'meter', 'handle'].includes(kind));
        const material = obj.material as T.MeshStandardMaterial;
        material.emissive.set(kind === state.component ? '#12605b' : '#000000');
        material.emissiveIntensity = 0.65;
      });
      controls.update();
      renderer.render(scene, camera);
    }
    animate();
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener('pointerup', pick);
      controls.dispose();
      disposeObject(scene);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);
  return (
    <>
      <div
        className="city-canvas"
        ref={container}
        data-testid="equipment-canvas"
      />
      {loading && <div className="scene-loading">正在加载配电设备…</div>}
      {error && (
        <div
          className="scene-error"
          role="alert"
        >
          设备加载失败：{error}
        </div>
      )}
      <div className="equipment-caption">
        10kV 智能配电柜 <span>SWG · NECC · 01</span>
      </div>
    </>
  );
}
/** 释放对象树的几何、纹理和材质。
 * @param root 即将卸载的 Three.js 对象树。
 * @returns 无返回值，释放 GPU 资源。
 */
function disposeObject(root: T.Object3D) {
  root.traverse((obj) => {
    if (obj instanceof T.Mesh || obj instanceof T.LineSegments) {
      obj.geometry.dispose();
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const material of materials) material.dispose();
    }
  });
}
