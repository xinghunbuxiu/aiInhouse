# AIInHouse Tauri 与平面图到 3D/全景完成度分析

更新日期: 2026-06-19

## 当前完成度

| 模块 | 完成度 | 说明 |
| --- | ---: | --- |
| Tauri 桌面壳 | 80% | 已使用 Tauri v2 配置、Rust command、前端运行时只保留 Tauri invoke；仍需在目标机器完成打包签名与安装包验证。 |
| 桌面运行时管理 | 75% | Tauri 可启动 backend 与 desktop-worker，支持状态、日志、配置保存、启动/停止/重启。 |
| AI 配置抽取 | 70% | 后端 `/config/ai-service` 已返回/保存统一 runtime 配置，worker `.env.example` 已集中识别、3D 渲染、全景渲染参数。 |
| 上传后自动全流程 | 80% | 上传平面图后自动创建 `full_pipeline` 或 `parse_floor_plan` 任务，桌面 Worker 在线后自动领取执行。 |
| 平面图解析与正式图 | 78% | 已有图像质量评分、OpenCV 线段/轮廓候选、本地 recognition-draft、大模型语义校正、拓扑修复链路，可输出 formal-plan JSON/SVG/DXF。 |
| 3D 装修效果 | 45% | 当前稳定产出 `3d-config.json` 和预览配置；已预留外部渲染命令接入真实效果图/GLB/Blend。 |
| 全景 VR 图 | 45% | 当前稳定产出 `panorama-config.json` 和热点机位；已预留外部命令接入 2:1 全景图或 VR tour 文件。 |

## 成熟项目接入建议

- Sweet Home 3D: 适合室内设计建模与人工/半自动布置，可作为“平面图 -> 室内模型 -> 效果图”的成熟工具链入口。
- Blender / BlenderProc: 适合脚本化批量渲染装修效果图、全景图和模型导出，推荐作为自动化渲染后端。
- Pannellum: 适合 Web 端全景 VR 浏览，当前 `panorama-config.json` 已按这类查看器组织机位与热点。

## 推荐落地路径

1. 短期: 使用当前 `full_pipeline` 自动生成 formal-plan、3D 配置、全景配置，保证业务流程闭环。
2. 短期: 在前端增加识别结果编辑器，重点补门窗、修房间名称、确认墙体闭合。
3. 中期: 用 `CODEX_RENDER_COMMAND` 接 BlenderProc 或内部渲染脚本，输出 `effect.jpg` / `scene.glb`。
4. 中期: 用 `CODEX_PANORAMA_COMMAND` 接 Blender 等距柱状渲染，输出 `living-room-360.jpg` 和 tour 文件。
5. 长期: 引入真实户型识别模型和材质/家具库，把房间语义、墙体、门窗、家具摆放从规则草稿升级为可审阅的生产级结果。

## 外部命令协议

3D 渲染命令:

```bash
<command> --job <job-context.json> --scene <3d-config.json> --output <output-dir>
```

输出 stdout JSON 或 `render-result.json`:

```json
{
  "output": {
    "effectImage": "effect.jpg",
    "modelFile": "scene.glb"
  },
  "summary": {
    "provider": "blenderproc"
  }
}
```

全景渲染命令:

```bash
<command> --job <job-context.json> --panorama <panorama-config.json> --output <output-dir>
```

输出 stdout JSON 或 `render-result.json`:

```json
{
  "output": {
    "panoramaImage": "living-room-360.jpg",
    "tourFile": "tour.html"
  },
  "summary": {
    "provider": "blender"
  }
}
```
