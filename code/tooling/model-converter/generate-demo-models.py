import struct, json, math
from pathlib import Path

root = Path(__file__).resolve().parents[2] / "apps/twin-screen/public/models"
root.mkdir(parents=True, exist_ok=True)


class GLB:
    def __init__(self):
        """初始化 GLB 缓冲区与节点清单。
        @returns 无返回值。
        """
        self.data = bytearray()
        self.views = []
        self.access = []
        self.meshes = []
        self.nodes = []
        self.materials = []

    def material(self, c, metal=0.3):
        """添加 PBR 材质。
        @param c RGBA 基础色。
        @param metal 金属度，范围 0 到 1。
        @returns 材质在 materials 数组中的索引。
        """
        self.materials.append(
            {
                "pbrMetallicRoughness": {
                    "baseColorFactor": c,
                    "metallicFactor": metal,
                    "roughnessFactor": 0.4,
                },
                "doubleSided": True,
            }
        )
        return len(self.materials) - 1

    def accessor(self, values, typ):
        """写入向量缓冲与访问器。
        @param values 逐顶点浮点向量数组。
        @param typ glTF 访问器类型，如 VEC3。
        @returns 访问器索引。
        """
        flat = [v for row in values for v in row]
        offset = len(self.data)
        self.data.extend(struct.pack("<" + "f" * len(flat), *flat))
        self.views.append(
            {"buffer": 0, "byteOffset": offset, "byteLength": len(flat) * 4}
        )
        n = len(values[0])
        self.access.append(
            {
                "bufferView": len(self.views) - 1,
                "componentType": 5126,
                "count": len(values),
                "type": typ,
                "min": [min(v[i] for v in values) for i in range(n)],
                "max": [max(v[i] for v in values) for i in range(n)],
            }
        )
        return len(self.access) - 1

    def mesh(self, name, verts, norms, mat, pos=(0, 0, 0)):
        """添加带法线的独立网格。
        @param name 节点名称，用于部件拾取。
        @param verts 顶点三元组列表。
        @param norms 对应的单位法线列表。
        @param mat 材质索引。
        @param pos 节点局部平移三元组。
        @returns 无返回值，将网格追加到场景。
        """
        a = self.accessor(verts, "VEC3")
        b = self.accessor(norms, "VEC3")
        self.meshes.append(
            {
                "primitives": [
                    {"attributes": {"POSITION": a, "NORMAL": b}, "material": mat}
                ]
            }
        )
        self.nodes.append(
            {"name": name, "mesh": len(self.meshes) - 1, "translation": list(pos)}
        )

    def box(self, name, size, pos, mat):
        """创建轴对齐长方体。
        @param name 部件节点名称。
        @param size 宽高深三元组。
        @param pos 局部中心坐标。
        @param mat 材质索引。
        @returns 无返回值，追加长方体网格。
        """
        x, y, z = [v / 2 for v in size]
        v = []
        n = []
        for normal, corners in [
            ((0, 0, 1), [(-x, -y, z), (x, -y, z), (x, y, z), (-x, y, z)]),
            ((0, 0, -1), [(x, -y, -z), (-x, -y, -z), (-x, y, -z), (x, y, -z)]),
            ((0, 1, 0), [(-x, y, z), (x, y, z), (x, y, -z), (-x, y, -z)]),
            ((0, -1, 0), [(-x, -y, -z), (x, -y, -z), (x, -y, z), (-x, -y, z)]),
            ((1, 0, 0), [(x, -y, z), (x, -y, -z), (x, y, -z), (x, y, z)]),
            ((-1, 0, 0), [(-x, -y, -z), (-x, -y, z), (-x, y, z), (-x, y, -z)]),
        ]:
            for i in (0, 1, 2, 0, 2, 3):
                v.append(corners[i])
                n.append(normal)
        self.mesh(name, v, n, mat, pos)

    def disc(self, name, rx, rz, h, pos, mat):
        """创建椭圆柱体。
        @param name 节点名称。
        @param rx X 轴半径。
        @param rz Z 轴半径。
        @param h 圆柱高度。
        @param pos 局部中心坐标。
        @param mat 材质索引。
        @returns 无返回值，追加椭圆柱网格。
        """
        v = []
        n = []
        for i in range(64):
            a = i * math.tau / 64
            b = (i + 1) * math.tau / 64
            p = (rx * math.cos(a), h / 2, rz * math.sin(a))
            q = (rx * math.cos(b), h / 2, rz * math.sin(b))
            lo = (p[0], -h / 2, p[2])
            lq = (q[0], -h / 2, q[2])
            v.extend([(0, h / 2, 0), q, p, p, q, lq, p, lq, lo])
            n.extend([(0, 1, 0)] * 3 + [(math.cos(a), 0, math.sin(a))] * 6)
        self.mesh(name, v, n, mat, pos)

    def save(self, path):
        """按 glTF 2.0 规范打包为 GLB。
        @param path 输出 GLB 文件路径。
        @returns 无返回值，写入二进制模型。
        """
        d = {
            "asset": {"version": "2.0", "generator": "InnoDL procedural demo asset"},
            "scene": 0,
            "scenes": [{"nodes": list(range(len(self.nodes)))}],
            "nodes": self.nodes,
            "meshes": self.meshes,
            "materials": self.materials,
            "buffers": [{"byteLength": len(self.data)}],
            "bufferViews": self.views,
            "accessors": self.access,
        }
        j = json.dumps(d, separators=(",", ":")).encode()
        j += b" " * ((-len(j)) % 4)
        self.data.extend(b"\0" * ((-len(self.data)) % 4))
        size = 12 + 8 + len(j) + 8 + len(self.data)
        path.write_bytes(
            struct.pack("<III", 0x46546C67, 2, size)
            + struct.pack("<II", len(j), 0x4E4F534A)
            + j
            + struct.pack("<II", len(self.data), 0x004E4942)
            + self.data
        )


g = GLB()
wall = g.material([0.15, 0.48, 0.52, 1])
roof = g.material([0.7, 0.89, 0.87, 1])
base = g.material([0.06, 0.18, 0.23, 1])
glass = g.material([0.06, 0.52, 0.58, 1])
g.box("Plaza", (1100, 8, 1100), (0, 4, 0), base)
for x, z in [(-225, -225), (225, -225), (-225, 225), (225, 225)]:
    g.disc("Hall", 265, 265, 46, (x, 31, z), wall)
    g.disc("Roof", 270, 270, 12, (x, 60, z), roof)
    for k in range(-5, 6):
        g.box("RoofSeam", (435, 1.1, 1.8), (x, 67, z + k * 29), wall)
g.disc("CentralAtrium", 125, 125, 35, (0, 31, 0), glass)
for x in [-535, 535]:
    g.box("Entrance", (28, 58, 370), (x, 32, 0), glass)
g.save(root / "exhibition-center.glb")
g = GLB()
metal = g.material([0.19, 0.32, 0.39, 1], 0.7)
blue = g.material([0.08, 0.19, 0.25, 1])
copper = g.material([0.85, 0.45, 0.16, 1], 0.8)
cyan = g.material([0.1, 0.86, 0.75, 1])
dark = g.material([0.025, 0.06, 0.08, 1])
g.box("floor", (7, 0.16, 4), (0, -0.08, 0), blue)
for i, x in enumerate([-2.1, -0.7, 0.7, 2.1]):
    g.box("cabinet-" + str(i), (1.28, 2.7, 1.1), (x, 1.35, 0), metal)
    g.box("door-" + str(i), (1.13, 2.5, 0.07), (x, 1.35, 0.6), blue)
    g.box("meter-" + str(i), (0.45, 0.34, 0.08), (x, 2.1, 0.66), cyan)
    g.box("breaker-" + str(i), (0.65, 0.6, 0.4), (x, 1.2, 0.25), dark)
    for phase, z in enumerate([-0.3, 0, 0.3]):
        g.box(
            "busbar-" + str(i) + "-" + str(phase),
            (0.1, 1.7, 0.1),
            (x + z, 1.45, 0.18),
            copper,
        )
    g.box("handle-" + str(i), (0.05, 0.3, 0.07), (x + 0.45, 1.5, 0.67), cyan)
g.save(root / "switchgear.glb")
