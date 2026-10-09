# 渲染器接入契约

## 目标

外部渲染器根据平面图结构、装修工序和素材库生成真实装修效果图、3D模型和 VR 全景图。

## 命令参数

`CODEX_RENDER_COMMAND` 会收到：

```bash
--job <job-context.json>
--scene <3d-config.json>
--assembly-plan <scene-assembly-plan.json>
--output <output-dir>
```

`CODEX_PANORAMA_COMMAND` 会收到：

```bash
--job <job-context.json>
--panorama <panorama-config.json>
--output <output-dir>
```

## 3D 渲染器输入

`scene-assembly-plan.json` 是核心输入：

- `roomPlans`: 每个房间的装修步骤。
- `steps`: 建墙、刷墙、铺地、吊顶、灯光、家具等动作。
- `asset`: 每个动作绑定的素材。
- `rendererAssets`: 渲染器需要下载/加载的模型和贴图清单。
- `rendererContract`: 输出要求。

## 3D 渲染器输出

外部命令可直接 stdout JSON，或写 `render-result.json`：

```json
{
  "output": {
    "effectImage": "effect-01.png",
    "renderImage": "living-room.png",
    "modelFile": "scene.glb",
    "glbFile": "scene.glb",
    "blendFile": "scene.blend"
  },
  "summary": "render completed"
}
```

## OpenAI / imagegen 接入

项目提供一个可选脚本：

```bash
node ../scripts/openai-image-renderer.mjs
```

配置示例：

```env
OPENAI_API_KEY=sk-...
CODEX_IMAGE_MODEL=gpt-image-2
CODEX_RENDER_COMMAND=node ../scripts/openai-image-renderer.mjs
CODEX_PANORAMA_COMMAND=node ../scripts/openai-image-renderer.mjs
```

3D 阶段会输出：

- `effect-openai.png`
- `openai-effect-prompt.txt`
- `openai-image-render-result.json`

VR 阶段会输出：

- `panorama-openai.png`
- `openai-panorama-prompt.txt`
- `openai-image-render-result.json`

没有 `OPENAI_API_KEY` 时，脚本会失败并由 worker 保留本地 SVG 预览作为兜底；这类结果只能标记为“可预览交付”，不能标记为照片级商用终稿。

## 本地 Raster 验收兜底

项目提供一个本地 SVG -> PNG 转换脚本：

```bash
node /absolute/path/to/AIInHouse/scripts/aiinhouse-rasterize-renderer.mjs
```

配置示例：

```env
CODEX_RENDER_COMMAND=node /absolute/path/to/AIInHouse/scripts/aiinhouse-rasterize-renderer.mjs
CODEX_PANORAMA_COMMAND=node /absolute/path/to/AIInHouse/scripts/aiinhouse-rasterize-renderer.mjs
```

它会输出：

- `effect-raster.png`，1600x1000
- `panorama-raster.png`，2048x1024，2:1
- `rasterize-render-result.json`

这个脚本用于链路验收、上传测试和尺寸门槛验证。它不等同于照片级渲染；如果用于最终客户交付，必须在 `delivery-approval.json` 中明确人工确认其视觉质量和素材授权。

## Blender 确定性渲染

项目提供一个 Blender 外部渲染器：

```bash
node ../scripts/aiinhouse-blender-renderer.mjs
```

服务器要求：

- 安装 headless Blender CLI，并确保 `blender` 在 `PATH` 中。
- 如果不在 `PATH` 中，设置 `BLENDER_BIN=/path/to/blender`，该路径必须是真实二进制可执行文件。
- 自动化渲染禁止使用 macOS `.app`、`open`、`/opt/homebrew/bin/blender` 这类会转调 `Blender.app` 的包装器；检测到后会直接失败，不会打开桌面客户端。
- Linux 服务器建议同时安装 `ffmpeg`，用于图片尺寸后处理和后续视频/全景扩展。

配置示例：

```env
CODEX_RENDER_COMMAND=node ../scripts/aiinhouse-blender-renderer.mjs
CODEX_PANORAMA_COMMAND=node ../scripts/aiinhouse-blender-renderer.mjs
CODEX_RENDER_TIMEOUT_MS=900000
CODEX_PANORAMA_TIMEOUT_MS=900000
```

也可以保留自动渲染器，让它按 `Blender -> OpenAI 图片 -> raster 兜底` 顺序尝试：

```env
AIINHOUSE_RENDER_TRY_BLENDER=true
CODEX_RENDER_COMMAND=node ../scripts/aiinhouse-auto-renderer.mjs
CODEX_PANORAMA_COMMAND=node ../scripts/aiinhouse-auto-renderer.mjs
```

输出文件：

- `effect-blender.png`，1600x1000。
- `panorama-blender.png`，2048x1024，2:1 equirectangular。
- `blender-render-result.json`，渲染器原始结果。
- `blender-effect-result.json` / `blender-panorama-result.json`，项目协议结果。

当前 Blender 渲染器是第一版结构化场景：会根据房间 bounds 生成墙、地、顶、基础家具、灯光和全景相机。它比纯 AI 生图更可控，但要达到酷家乐级别，还需要继续接入真实家具/材质模型库、门窗洞口、相机位优化和房间级多图渲染。

## VR 渲染器输出

```json
{
  "output": {
    "panoramaImage": "panorama-living.jpg",
    "equirectangularImage": "panorama-bedroom.jpg",
    "tourFile": "tour.html"
  },
  "summary": "panorama completed"
}
```

## 实现建议

1. 先用 Three.js 离屏渲染 GLB/材质，输出普通效果图。
2. 再用 Blender/BlenderProc 进行照片级渲染。
3. VR 图必须是 2:1 equirectangular 图片。
4. 每个房间至少一个相机位。
5. 不能识别门窗时应输出警告，不要生成全封闭真实交付图。

## 商用验收门槛

1. `formal-plan.json` 房间数量、名称和相对位置必须与原始户型图一致。
2. `3d-config.json` 必须包含 `renderer.commercialRenderSpec` 和 `renderer.acceptanceCriteria`。
3. `panorama-config.json` 必须包含 `viewer.commercialVrSpec`，且相机位/热点覆盖所有可进入房间。
4. 照片级交付必须至少包含一个 PNG/JPG 效果图和一个 2:1 PNG/JPG 全景图；仅有 SVG 预览时不能宣称为最终商用图。
5. 交付前必须保留素材来源和授权记录，避免无授权模型、贴图、品牌标识或水印。
