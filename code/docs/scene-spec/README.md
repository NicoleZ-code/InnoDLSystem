# 场景与资产约定

城市坐标统一 WGS84，经纬度单位为度、高度为米。模型局部坐标为米；生成的会展中心位于 121.302 / 31.188，Cesium 采用 ENU→ECEF 放置。设备独立场景采用 Three.js 米制坐标。

assets/expo 与 assets/equipment 保存自建 GLB；assets/city 说明程序化底座；assets/stations 为正式站房模型预留目录。运行静态资产复制至 twin-screen/public/models，不依赖在线地图 Token、CDN 或外部模型。`python3 tooling/model-converter/generate-demo-models.py` 可重建演示 GLB。

上传流程：申请短期签名 → 同源 PUT GLB → complete 校验 magic/version/实际大小（≤50 MB） → 创建业务资产与模型绑定 → 发布场景。文件名由服务器 UUID 生成；上传和资产编码独立。MinIO 对象流经同源 API，浏览器不访问 Docker 内部地址。

发布快照包含已批准模型绑定，目录 revision 变化驱动大屏更新。引擎通过 assetId 建立拾取与状态联动；颜色、图层、镜头、模型解析、业务拾取和生命周期分别位于 twin-engine 子模块。相机快照跨独立设备场景保留。模型 node 名称用于部件选择，switchgear 的 cabinet/door/meter/breaker/busbar/handle 可分别定位。

支持 /twin/overview、/twin/area/:areaId、/twin/protection/:eventId、/twin/station/:stationId、/twin/device/:assetId、/twin/topology、/twin/alarms、/twin/replay。当前 alarms 路由复用全景告警面板，replay 路由复用只读时间轴。

演示建筑和模型不代表真实测绘/BIM；没有源模型时不声称视频级几何复刻。正式模型接入需提供单位、轴向、原点、授权与材质贴图，BIM/3D Tiles 转换需适配实际源格式。
