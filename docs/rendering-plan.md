# AIInHouse 装修效果图与 VR 全景生成规划

## 当前结论

生产渲染仅允许使用 OpenAI 官方 API：`https://api.openai.com/v1`。

生产配置固定为：

```env
OPENAI_IMAGE_BASE_URL=https://api.openai.com/v1
OPENAI_IMAGE_MODE=images
CODEX_IMAGE_MODEL=gpt-image-2
CODEX_REQUIRE_OFFICIAL_OPENAI=true
CODEX_IMAGE_USE_REFERENCE=true
OPENAI_IMAGE_REQUEST_TIMEOUT_MS=120000
OPENAI_PANORAMA_IMAGE_REQUEST_TIMEOUT_MS=240000
OPENAI_IMAGE_MAX_RETRIES=1
CODEX_WORKER_MODE=local_pipeline
CODEX_RENDER_COMMAND=node ../scripts/aiinhouse-auto-renderer.mjs
CODEX_PANORAMA_COMMAND=node ../scripts/aiinhouse-auto-renderer.mjs
```

`OPENAI_API_KEY` 放在服务器环境变量或 `codex-worker/.env` 中，不放前端。

## 推荐架构

```text
客户浏览器
  -> backend
  -> server-worker/codex-worker(local_pipeline)
  -> OpenAI Images API
  -> 保存 effect-openai.png / panorama-openai.png
  -> 回写 floor_plans.preview_image_url / panorama_url
  -> 交付页展示
```

客户不需要安装 Codex。Codex CLI 只作为服务器内部可选推理器，不建议作为生产主链路依赖。

## 阶段规划

### 阶段 1：可交付预览

- 使用 OpenAI Images API 生成效果图和 VR 图。
- 失败时使用本地 SVG 转 PNG 兜底。
- 后台展示 `delivery-manifest.json` 的 gates。
- 全景图生成比普通效果图慢，生产建议单独配置 `OPENAI_PANORAMA_IMAGE_REQUEST_TIMEOUT_MS=240000`，并允许至少 1 次重试。
- 部分第三方中转会返回比请求尺寸更小的图片；当前脚本会在生成后用 `ffmpeg`/`sips` 补到验收尺寸。Linux 服务器推荐安装 `ffmpeg`。

目标：客户可以看到装修效果图和 VR 全景图。

当前项目状态：

- 效果图和 VR 全景图链路已经可以完成到 `preview_ready`。
- 自动验收中，正式平面图、效果图 PNG、全景 PNG、2:1 分辨率、VR 热点覆盖、商用规格 gates 可以通过。
- `commercial_ready` 仍需要人工终审和素材授权确认，这两个 gate 不应自动放开。
- 官方图片接口失败时保留错误和本地结构预览；本地预览不等同照片级商用渲染，也不能通过可信渲染门禁。

### 阶段 2：结构准确性增强

- 用本地识别器输出正式平面图、房间、墙体、门窗。
- 用 Codex CLI 或服务端模型只做结构校对和 prompt 生成。
- 将户型结构摘要写入 image prompt。

目标：图像更接近真实户型。

### 阶段 3：成熟渲染管线

- 接 Blender / BlenderProc 输出真实 3D 效果图和 2:1 全景图。
- AI 图像生成只做风格增强，不作为唯一结构来源。

目标：可商用、可复核、可批量稳定交付。

## 开源项目选择

- Blender / BlenderProc：服务器脚本化渲染，适合最终商用。
- Sweet Home 3D：适合人工/半自动室内布置。
- ComfyUI：适合本地 AI 生图和 ControlNet 工作流，但结构一致性需要调参。
- Pannellum：负责 Web 端 VR 全景浏览，当前项目已接入。

## 验收标准

- 效果图：PNG/JPG/WebP，分辨率不低于 1600x1000。
- VR 图：PNG/JPG/WebP，2:1 equirectangular，分辨率不低于 2048x1024。
- `delivery-manifest.json` 中 effect/panorama 相关 gates 通过。
- 人工确认户型结构、房间位置、门窗、热点和素材授权。
