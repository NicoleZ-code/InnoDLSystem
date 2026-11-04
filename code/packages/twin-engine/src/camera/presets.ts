import * as C from 'cesium';
export interface CameraSnapshot {
  longitude: number;
  latitude: number;
  height: number;
  heading: number;
  pitch: number;
  roll: number;
}
/** 读取可序列化镜头，用于跨页面返回时恢复视角。
 * @param viewer 当前城市 Viewer。
 * @returns WGS84 位置与弧度制镜头姿态。
 */
export function captureCamera(viewer: C.Viewer): CameraSnapshot {
  const p = viewer.camera.positionCartographic;
  return {
    longitude: C.Math.toDegrees(p.longitude),
    latitude: C.Math.toDegrees(p.latitude),
    height: p.height,
    heading: viewer.camera.heading,
    pitch: viewer.camera.pitch,
    roll: viewer.camera.roll,
  };
}
/** 恢复之前保存的镜头快照。
 * @param viewer 当前城市 Viewer。
 * @param snapshot 保存的镜头状态。
 * @returns 无返回值，镜头即时更新。
 */
export function restoreCamera(viewer: C.Viewer, snapshot: CameraSnapshot) {
  viewer.camera.setView({
    destination: C.Cartesian3.fromDegrees(snapshot.longitude, snapshot.latitude, snapshot.height),
    orientation: { heading: snapshot.heading, pitch: snapshot.pitch, roll: snapshot.roll },
  });
}
