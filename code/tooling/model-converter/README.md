# 模型工具

运行 `python3 tooling/model-converter/generate-demo-models.py` 生成会展中心与设备 GLB，只有 Python 标准库依赖。生成器输出到三维前端 public/models；assets/expo 和 assets/equipment 保留当前交付版本。

后端检查 GLB magic、版本、声明大小和实际大小。当前工具是演示几何生成器，通用 IFC/Revit/倾斜摄影到 3D Tiles 转换仍取决于实际源格式和授权工具。
