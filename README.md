# AIInHouse - 平面图管理与3D全景生成系统

## 项目简介

AIInHouse 是一个面向本地房产业务的平面图管理与交付系统，覆盖楼盘、楼栋、房屋、平面图、3D 配置和全景交付的完整流程。当前项目已经从“后端直接跑 AI”逐步调整为“后台排队调度 + 桌面端本地 Codex 执行”的新架构，更适合在本地电脑上处理手绘转正式图、3D 装修效果配置和全景配置生成。

## 核心功能

- **楼盘管理**：创建、查询、更新、删除楼盘信息
- **房屋管理**：管理楼盘下的房屋信息
- **平面图管理**：上传、管理平面图，支持解析和生成3D场景
- **AI任务调度**：
  - 平面图解析任务
  - 手绘稿转正式图
  - 3D 配置任务
  - 全景配置任务
  - 桌面端设备注册、任务领取、结果回传、人工审核
- **配置管理**：管理系统配置、AI服务配置、风格配置、提示模板配置

## 技术栈

### 前端
- Vue 3 + Vite
- Tailwind CSS
- Three.js（3D场景构建）
- Pannellum（全景图查看）
- Axios（HTTP请求）

### 后端
- Node.js + Express
- MySQL
- JWT + bcrypt（用户认证）
- Multer（文件上传）

### 本地 AI 处理
- 后台任务中心：Express + MySQL
- 桌面执行器：Node.js desktop worker
- 本地处理器：Codex worker（支持 mock / external command / codex_cli 三种模式）

## 系统架构

### 数据库设计
- **users**：用户表
- **system_configs**：系统配置表
- **ai_devices**：桌面处理设备表
- **ai_jobs**：AI任务表
- **ai_job_logs**：AI任务日志表
- **buildings**：楼盘表
- **houses**：房屋表
- **floor_plans**：平面图表
- **delivery_snapshots**：平面图交付快照表
- **operation_logs**：操作日志表

### API架构
- **认证API**：`/api/auth/*`
- **配置API**：`/api/config/*`
- **楼盘API**：`/api/buildings/*`
- **房屋API**：`/api/houses/*`
- **平面图API**：`/api/floor-plans/*`
- **交付快照API**：`/api/floor-plans/:id/delivery-snapshots/*`
- **文件上传API**：`/api/upload/*`
- **AI设备API**：`/api/ai-devices/*`
- **AI任务API**：`/api/ai-jobs/*`

## 安装与部署

### 1. 环境准备
- MySQL 5.7+
- Node.js 18+
- npm 6+

### 2. 数据库初始化
```bash
# 导入数据库脚本
mysql -u root -p < database/schema.sql

# 或使用后端初始化脚本
npm --prefix backend run init-db

# 默认管理员账号
# 用户名: admin
# 密码: admin123
```

### 2.1 交付快照迁移
如果你的数据库是旧版本，只想增量补齐交付快照表，可以单独执行：

```bash
mysql -u root -p aiinhouse < backend/scripts/migrations/20260403_add_delivery_snapshots.sql
```

后端启动时也会自动检查并创建 `delivery_snapshots` 表，因此本地开发环境通常不需要手工重复建表。

### 3. 后端服务
```bash
cd backend
npm install
cp .env.example .env  # 编辑数据库配置
npm run dev

# 服务运行在: http://localhost:3002
```

后端启动后会自动执行以下自检：
- 校验数据库连接
- 自动确保 `delivery_snapshots` 表存在
- 自动确保 `ai_devices`、`ai_jobs`、`ai_job_logs` 表存在
- 自动补齐 `floor_plans` 的 AI 交付字段

### 4. 前端服务
```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 访问: http://localhost:5173
```

### 5. 桌面端 worker（推荐）
```bash
cp desktop-worker/.env.example desktop-worker/.env
cp codex-worker/.env.example codex-worker/.env

# 根据实际账号修改 desktop-worker/.env
# 默认会调用 codex-worker mock 处理器

node desktop-worker/src/index.js

# worker 会自动:
# 1. 登录后台
# 2. 注册本机设备
# 3. 领取待处理任务
# 4. 下载源图
# 5. 调用本地处理器
# 6. 上传交付结果
# 7. 回传任务结果
```

如果本地开发环境里的管理员密码不是默认值，也不用卡在这里。`desktop-worker` 在非生产环境下会在登录失败时自动回退到 `mock-token-12345`，方便先把设备注册、任务领取和结果回传链路跑通。

### 6. 切换为真实本地 Codex 执行

`codex-worker` 默认使用 mock 模式，便于先把链路打通。如果要改成你本机真实 Codex 执行，推荐优先使用 `codex_cli` 模式：

```bash
# codex-worker/.env
CODEX_WORKER_MODE=codex_cli
CODEX_REAL_COMMAND=codex
CODEX_REAL_ARGS_TEMPLATE=exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox -C {{outputDir}} --output-schema {{schemaFile}} -
```

约定如下：

1. `codex-worker` 会先自动生成 `codex-brief.md`、`job-context.json` 和 `codex-result.schema.json`
2. 它会通过标准输入把 prompt 喂给 `codex exec`
3. 你本机 Codex CLI 根据 prompt 生成正式图 JSON、3D 配置、全景配置、审核说明和预览图
4. Codex CLI 执行完成后，可以二选一：
   - 在 `stdout` 输出 JSON
   - 写入 `codex-result.json`
5. JSON 中 `output` 要告诉系统生成了哪些文件，路径相对于 `output-dir`

这样桌面 worker 不需要改，仍然调用 `codex-worker`，只是 `codex-worker` 内部会把 AI 任务自动翻译成 Codex CLI 可执行的上下文。

如果你的本机命令不是直接的 `codex`，也可以继续使用 `external_command` 模式，自己完全接管参数拼接。

### 7. 图片识别增强链路

当前项目已经开始切换到“AI 识别优先 + OpenCV 预处理可选 + 本地几何识别兜底”的混合方案，核心思路如下：

1. `desktop-worker` 下载原始图纸到本地工作区。
2. `codex-worker` 可选执行图像预处理，输出 `recognition-preprocess.json`。
3. 然后优先调用 AI 识别器生成 `recognition-draft.json`。
4. 如果 AI 不可用，再回退到本地识别器或规则草稿。
5. 后续继续生成正式图、3D 配置和全景配置。

当前仓库里的 `recognition-draft.json` 还是第一版骨架，主要用于固定协议。后面可以逐步替换为：

- OpenCV 的二值化、去噪、透视矫正、墙线提取
- YOLO / 检测模型的门窗和符号识别
- OCR 的尺寸线、手写备注提取
- iPad / 平板采集端导入的结构化绘图数据

这样无论识别模型怎么变，后面的正式图、3D 和全景链路都不用推翻。

如果你想先验证“AI 优先”接法，推荐先这样配：

```bash
# codex-worker/.env
CODEX_RECOGNITION_MODE=ai_first
CODEX_RECOGNITION_AI_COMMAND=codex
CODEX_RECOGNITION_AI_ARGS_TEMPLATE=exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox -C {{outputDir}} --output-schema {{schemaFile}} -
# 可选
CODEX_RECOGNITION_PREPROCESS_COMMAND=node ../scripts/floorplan-preprocess.mjs
# 兜底
CODEX_RECOGNITION_COMMAND=node ../scripts/mock-floorplan-recognizer.mjs
```

如果你暂时不想上真实 AI，也可以只用示例脚本先串链路：

```bash
CODEX_RECOGNITION_PREPROCESS_COMMAND=node ../scripts/floorplan-preprocess.mjs
CODEX_RECOGNITION_COMMAND=node ../scripts/mock-floorplan-recognizer.mjs
```

后续只需要把：

- `CODEX_RECOGNITION_PREPROCESS_COMMAND` 默认使用 `scripts/floorplan-preprocess.mjs`，负责图像质量评分、线段/轮廓候选提取
- `CODEX_RECOGNITION_COMMAND` 默认可使用 `scripts/floorplan-local-recognizer.mjs`，在没有大模型时根据几何候选生成本地 recognition-draft
- `CODEX_RECOGNITION_COMMAND` 替换成你的 Python/OpenCV 几何识别脚本

主链路不用改。

## 使用指南

### 1. 登录系统
使用默认管理员账号登录系统：
- 用户名：admin
- 密码：admin123

### 2. 配置管理
- **系统设置**：配置系统基本信息
- **AI服务配置**：配置AI服务参数，包括本地服务和OpenAI服务
- **风格配置**：管理3D场景风格
- **提示模板配置**：管理AI提示模板

### 3. 业务管理
- **楼盘管理**：创建和管理楼盘信息
- **房屋管理**：管理楼盘下的房屋信息
- **平面图管理**：上传平面图，解析生成3D场景

### 4. AI服务使用
- **上传平面图**：在房屋维度上传电子图或手绘图
- **提交桌面任务**：在平面图详情页发起解析、3D、全景或全流程任务
- **查看队列**：在“AI 任务中心”查看设备在线情况和任务状态
- **人工审核**：对桌面端回传的结果进行通过或打回
- **交付快照**：在平面图详情页保存版本、下载版本包、回滚历史版本、删除历史版本并进行差异对比

### 5. 交付工作流
推荐按下面顺序使用系统：

1. 先建立楼盘、楼栋、房屋基础信息。
2. 在平面图管理中上传电子图纸或手绘草图。
3. 对手绘图选择“手绘草图”来源，让系统自动转成正式平面图结构。
4. 在平面图详情页提交桌面端任务，交由本地 Codex worker 执行。
5. 在“AI 任务中心”跟进设备领取、执行、失败、待审核状态。
6. 审核通过后导出 `SVG`、`PNG`、结果包 `JSON`。
7. 在确认节点保存“交付版本”，后续可直接做历史回滚和版本对比。

## 系统特点

1. **配置化管理**：所有配置都存储在MySQL数据库中，可通过前端管理页面进行配置
2. **模块化设计**：清晰的代码结构，易于维护和扩展
3. **安全性**：完善的认证和权限控制
4. **可靠性**：错误处理和fallback机制
5. **可扩展性**：预留了文件上传、AI服务集成等扩展点
6. **本地执行架构**：后台只负责调度和审核，真实处理放在桌面端，更适合接入本机 Codex

## 常见问题

### 1. 数据库连接失败
- 检查数据库服务是否启动
- 检查.env文件中的数据库配置是否正确
- 确保MySQL用户有足够的权限

### 2. 桌面端任务一直不执行
- 检查 `desktop-worker` 是否已启动
- 检查 `desktop-worker/.env` 中后台地址、账号密码是否正确
- 检查“AI 任务中心”里是否已有在线设备
- 检查任务是否被指定给了其他设备

### 3. 真实 Codex 命令未生效
- 检查 `codex-worker/.env` 中 `CODEX_WORKER_MODE=external_command`
- 检查 `CODEX_REAL_COMMAND` 能否在本机独立运行
- 检查真实命令是否按约定输出 JSON

### 4. 文件上传失败
- 检查文件大小是否超过限制
- 检查文件类型是否支持
- 检查上传目录权限是否正确

### 5. 交付快照不生效
- 先检查数据库中是否已存在 `delivery_snapshots` 表
- 可执行 `npm --prefix backend run init-db`
- 或单独执行 `backend/scripts/migrations/20260403_add_delivery_snapshots.sql`
- 若新表暂不可用，前端会自动回退到 `parse_result.meta.deliveryHistory` 方案

## 项目结构

```
AIInHouse/
├── backend/            # 后端服务
│   ├── config/         # 配置文件
│   ├── middleware/     # 中间件
│   ├── routes/         # API路由
│   ├── scripts/        # 数据库初始化与迁移脚本
│   ├── services/       # 业务逻辑
│   └── server.js       # 服务器入口
├── desktop-worker/     # 桌面端任务执行器
├── codex-worker/       # 本地 Codex 处理适配层
├── database/           # 数据库脚本
│   └── schema.sql      # 数据库表结构
├── src/                # 前端代码
│   ├── components/     # 组件
│   ├── config/         # 配置
│   ├── services/       # 服务
│   ├── views/          # 页面
│   └── main.js         # 前端入口
└── README.md           # 项目说明
```

## 许可证

MIT License

## 联系方式

如有问题或建议，欢迎联系我们。
