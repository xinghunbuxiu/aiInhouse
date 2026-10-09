# AIInHouse 装修素材库规划

## 当前内置素材

项目已提供一批可直接用于预览和早期商用验证的程序化素材，保存在：

- `backend/data/design-assets.json`
- `backend/uploads/design-assets/generated/*.svg`

这些素材不是外部下载模型，而是项目自生成的程序化占位资产。授权字段为：

```text
Project-owned procedural placeholder; generated geometry/material only.
```

它们适合：

- 结构化 3D 渲染占位。
- AI prompt 语义增强。
- Blender 第一版自动布置。
- 客户预览、内部审核和流程验收。

它们不等同于酷家乐级别照片级模型库。要做最终商用精装效果，还需要逐步替换为真实 PBR 材质和家具模型。

## 已加入的外部素材源白名单

### Poly Haven

- 地址: https://polyhaven.com/
- 用途: HDRI、PBR 材质、部分 3D 模型。
- 授权: CC0。
- 建议: 优先用于 HDRI 环境光、木地板、石材、布料、室内小件。

### ambientCG

- 地址: https://ambientcg.com/
- 用途: PBR 材质贴图。
- 授权: CC0。
- 建议: 优先用于木地板、瓷砖、墙面、石材、混凝土等硬装材质。

### Kenney

- 地址: https://kenney.nl/assets
- 用途: 低模 3D 资产和原型素材。
- 授权: CC0。
- 建议: 适合早期替换程序化占位模型；视觉偏低模，不适合作为照片级终稿。

### Khronos glTF Sample Assets

- 地址: https://github.com/KhronosGroup/glTF-Sample-Assets
- 用途: glTF 导入器测试。
- 授权: 混合授权。
- 建议: 只用于测试，不要整库作为商用素材库。商用前必须逐个模型核验 license。

## 下一阶段素材落地

1. 下载 CC0 PBR 材质到 `backend/uploads/design-assets/pbr/`。
2. 下载或自建 GLB 家具模型到 `backend/uploads/design-assets/models/`。
3. 在 `design-assets.json` 中为每个素材补齐:
   - `modelUrl`
   - `textureUrl`
   - `previewUrl`
   - `sourceUrl`
   - `license`
4. Blender 渲染器优先加载 `modelUrl`，没有模型时才使用程序化几何。
5. 交付前由 `delivery-approval.json` 确认素材授权。

## 批量导入命令

把下载好的 CC0 模型或贴图放到一个临时目录后运行：

```bash
node scripts/import-design-assets.mjs \
  --source /path/to/cc0-assets \
  --license "CC0; source verified before import" \
  --source-url "https://polyhaven.com/"
```

可选参数：

```bash
--category furniture
--scene-types living,bedroom
--dry-run
```

导入脚本会复制模型到：

- `backend/uploads/design-assets/models/`
- `backend/uploads/design-assets/textures/`

并更新 `backend/data/design-assets.json`。Blender 渲染器会优先读取素材中的 `modelUrl` / `textureUrl`，读取失败时回退到程序化占位资产。

## 自生成 GLB 模型

项目可以生成版权干净的程序化 GLB 占位模型：

```bash
node scripts/generate-procedural-glb-assets.mjs
```

当前会生成：

- `procedural-modern-sofa-glb`
- `procedural-queen-bed-glb`
- `procedural-dining-set-glb`

这些模型会写入 `backend/uploads/design-assets/models/procedural/`，并登记到素材库，授权为项目自有程序化生成。

## Poly Haven 小批量下载

项目提供 Poly Haven CC0 下载器，默认只下载白名单小批量素材，并保留来源和授权字段：

```bash
node scripts/download-polyhaven-assets.mjs --resolution 1k
```

也可以只下载指定素材：

```bash
node scripts/download-polyhaven-assets.mjs --resolution 1k --ids Sofa_01,wood_table_001
```

先预演：

```bash
node scripts/download-polyhaven-assets.mjs --dry-run --resolution 1k --ids Sofa_01
```

已验证下载：

- `polyhaven-sofa-01`: GLTF 沙发模型，CC0。
- `polyhaven-wood-table-001`: 1k 木材 PBR 贴图，CC0。
- `polyhaven-woodentable-01`: GLTF 木桌模型，CC0。
- `polyhaven-woodenchair-01`: GLTF 木椅模型，CC0。
- `polyhaven-classicnightstand-01`: GLTF 床头柜模型，CC0。
- `polyhaven-classicconsole-01`: GLTF 边柜/玄关柜模型，CC0。
- `polyhaven-greenchair-01`: GLTF 单椅模型，CC0。
- `polyhaven-ottoman-01`: GLTF 脚凳模型，CC0。

当前 Poly Haven 下载目录约 7MB，适合随项目作为轻量演示素材；后续如要照片级质量，可逐步提高分辨率或替换为精选模型包。
