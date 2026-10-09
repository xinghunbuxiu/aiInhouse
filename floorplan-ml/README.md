# Floorplan ML — 墙结构分割

目标：用监督学习从平面图预测墙 mask，再矢量化成 `walls[]`，供现有 `3d-config` 挤出。

## 数据
```bash
python3 scripts/build_kujiale_wall_dataset.py \
  --data-root ../backend/uploads/floorplans/kujiale-3d \
  --out data/kujiale-wall
```
输入：`withoutDimensionLine.jpg`  
标签：`wallCenterLine.jpg` → 二值墙 mask

## 训练（Apple MPS）
```bash
cd floorplan-ml
PYTHONPATH=. python3 -m buildingcv.train --config configs/wall_unet_mps.yaml
```

## 推理
```bash
PYTHONPATH=. python3 -m buildingcv.infer \
  --checkpoint runs/<run>/best.pt \
  --image path/to/plan.jpg \
  --out-dir /tmp/ml-wall-out
```

## Worker 接入
默认开启（有 `checkpoints/wall-best.pt` 时）：
- `CODEX_ML_WALL_ENABLED=1`（设 `0` 关闭）
- `CODEX_ML_WALL_CHECKPOINT` 可选，默认 `floorplan-ml/checkpoints/wall-best.pt`
- `CODEX_ML_WALL_DEVICE=mps`

识别流水线在预处理后调用 `buildingcv.infer`（含线段合并 + 房间网格线），墙段/网格线写入 `preprocessing.geometryCandidates`，`buildRecognitionDraft` **优先用 ML 墙网格** 切房间。

训练完成参考：`runs/20260825-182633/summary.json`（best val IoU **0.890**）。
