# 平面图识别资产（制图标准图例）

识别资产把常见平面图绘制标准整理成可执行图元本体，供：

- 识别 scanner 绑定与门禁证据
- 前端「识别图例库」浏览复核
- 启发式候选 → 标准图元匹配
- **尺寸线/栏杆等噪声从墙体候选中排除**

当前版本：**1.3.1**，共 **91** 个图元、**13** 个分类。

## 文件位置

- 本体数据：`backend/data/recognition-assets.json`
- 图例 SVG：`backend/uploads/recognition-assets/glyphs/*.svg`
- 同步脚本：`node scripts/sync-recognition-glyphs.mjs`
- API：`/api/recognition-assets`、`/api/recognition-assets/catalog`、`/api/recognition-assets/:id`
- 前端页面：`/admin/recognition-assets`
- Worker 加载：`codex-worker/src/assets/recognition-assets.js`
- 匹配引擎：`codex-worker/src/assets/recognition-matcher.js`

## 分类覆盖

| 分类 | 数量 | 示例 |
|------|------|------|
| 墙体 | 9 | 外墙、承重墙、隔墙、双线墙、幕墙、玻璃隔断、拟拆除墙、半墙 |
| 柱与剪力墙 | 3 | 方柱、圆柱、剪力墙 |
| 门窗洞口 | 17 | 平开/双开/推拉/折叠/暗藏/入户/拱形/子母门、各类窗、垭口 |
| 栏杆护栏 | 3 | 阳台栏杆、楼梯扶手、玻璃栏板 |
| 阳台露台 | 4 | 阳台、露台、天井、飘窗台 |
| 交通核 | 5 | 直行/L/U/螺旋楼梯、电梯井 |
| 管井烟道 | 5 | 烟道、管井、水井、电井、空调机位 |
| 洁具厨电 | 11 | 马桶、洗手盆、浴缸、淋浴、灶台、壁龛、过门石、窗帘盒等 |
| 家电设备 | 4 | 冰箱、油烟机、热水器、洗碗机 |
| 家具图例 | 10 | 床、沙发、桌、衣柜、餐桌椅、电视柜、书桌、椅子、储物柜、床头柜 |
| 暖通地暖 | 4 | 地暖回路、暖气片、空调室内机、新风口 |
| 电气点位 | 5 | 强电插座、弱电/网络点、单控开关、吸顶灯/筒灯、灯带 |
| 标注尺寸 | 10 | 尺寸线、房间文字、指北针、轴线、标高、剖切、比例尺、图框、轴网、面积标注 |

> 注：v1.3.0 新增暖通地暖、电气点位及飘窗台、壁龛、过门石等精装图例；门/窗候选支持 `doorType` / `windowType` / `hasSwingArc` 字段增强匹配。

## 资产字段

每个图元包含：

- `drawingRules`：线型、厚度、填充、常见变体
- `recognitionHints`：视觉特征、几何先验、应拒绝条件
- `scannerIds`：绑定到现有 scanner
- `modelRole` / `outputField`：进入正式模型的角色与字段

## 解析顺序

`annotation → wall → column → opening → railing → outdoor → circulation → shaft → fixture → appliance → mep → electrical → furniture`

先排除尺寸/标题噪声，再认结构与洞口，最后用家具/洁具/机电做语义。

## 流水线接入

1. **预处理** `scripts/floorplan-preprocess.mjs`：几何候选自动标注 `assetMatch`；Python 侧 `classify_wall_candidate` 输出 `wallRejectReasons`，标注线标记为 `annotation-line-candidate`
2. **墙体过滤** `shouldExcludeLineFromWalls()`：标注线/栏杆不进墙线建模
3. **识别草稿** `local-draft.js`：墙体 `structuralType` + 资产角色
4. **AI Prompt** `prompt-builder.js`：注入 `recognitionAssetGuide`
5. **诊断报告** `generate-recognition-diagnostics.mjs`：图例匹配统计；叠加层含暖通/电气候选
6. **正式图 meta**：`recognitionAssetMatchCount`、`excludedAnnotationLineCount` 写入 parse_result

## v1.3.1 增量（MEP/电气 scanner）

- Python `detect_mep_electrical_candidates()`：小圆点（插座/筒灯）、开关、灯带、暖气片、空调内机、新风口、地暖平行细线
- Matcher：`matchMepSymbol` / `matchElectricalSymbol`
- Scanner：`mep-symbol-scanner`、`electrical-symbol-scanner`

## 维护

新增或修改图元后运行：

```bash
node scripts/sync-recognition-glyphs.mjs
```

重启后端使 API 读取最新 JSON。
