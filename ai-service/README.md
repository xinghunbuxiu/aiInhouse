# AI平面图解析服务

基于Python + FastAPI + YOLOv8 + PaddleOCR的家装平面图智能解析服务。

## 功能特性

- **图像预处理**：去噪、增强、矫正、调整大小
- **目标检测**：识别房间、墙体、门窗、家具等元素
- **OCR识别**：提取尺寸标注和房间标签
- **平面图解析**：整合检测结果，生成结构化数据
- **RESTful API**：提供HTTP接口供前端调用

## 技术栈

- **Web框架**：FastAPI
- **目标检测**：YOLOv8 (Ultralytics)
- **OCR识别**：PaddleOCR
- **图像处理**：OpenCV, Pillow
- **日志**：Loguru

## 安装

### 1. 创建虚拟环境

```bash
cd ai-service
python -m venv venv
source venv/bin/activate  # Linux/Mac
# 或
venv\Scripts\activate  # Windows
```

### 2. 安装依赖

```bash
pip install -r requirements.txt
```

### 3. 下载模型（可选）

如果需要使用真实的AI模型，需要下载或训练YOLOv8模型：

```bash
# 创建模型目录
mkdir -p models

# 下载预训练模型（示例）
# wget https://example.com/yolov8_floor_plan.pt -O models/yolov8_floor_plan.pt
```

如果没有模型，服务将使用模拟数据进行测试。

## 运行服务

### 开发模式

```bash
python main.py
```

服务将在 http://localhost:8000 启动

### 生产模式

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4
```

## API接口

### 1. 健康检查

```http
GET /
GET /health
```

### 2. 解析平面图

```http
POST /api/parse
Content-Type: multipart/form-data

file: <平面图文件>
```

### 3. 模拟解析（测试用）

```http
POST /api/parse/mock
Content-Type: multipart/form-data

file: <任意文件>
```

## 响应格式

```json
{
  "success": true,
  "message": "解析成功",
  "data": {
    "rooms": [
      {
        "id": 1,
        "name": "客厅",
        "type": "living_room",
        "width": 4.5,
        "length": 5.0,
        "area": 22.5,
        "doors": [...],
        "windows": [...],
        "furniture": [...]
      }
    ],
    "walls": [...],
    "doors": [...],
    "windows": [...],
    "furniture": [...],
    "total_area": 47.0,
    "dimensions": {
      "width": 11.0,
      "length": 12.5
    }
  },
  "processing_time": 2.34
}
```

## 测试

### 使用curl测试

```bash
# 健康检查
curl http://localhost:8000/health

# 解析平面图
curl -X POST -F "file=@/path/to/floor_plan.jpg" http://localhost:8000/api/parse/mock
```

### 使用Python测试

```bash
python app/image_processor.py /path/to/image.jpg
python app/object_detector.py /path/to/image.jpg
python app/ocr_recognizer.py /path/to/image.jpg
python app/floor_plan_parser.py /path/to/image.jpg
```

## 目录结构

```
ai-service/
├── app/
│   ├── __init__.py
│   ├── image_processor.py    # 图像预处理
│   ├── object_detector.py    # 目标检测
│   ├── ocr_recognizer.py     # OCR识别
│   └── floor_plan_parser.py  # 平面图解析
├── models/                   # 模型文件
├── data/                     # 数据文件
├── logs/                     # 日志文件
├── uploads/                  # 上传文件
├── tests/                    # 测试文件
├── main.py                   # 主程序
├── requirements.txt          # 依赖列表
├── .env                      # 环境配置
└── README.md                 # 说明文档
```

## 配置

通过 `.env` 文件配置服务参数：

```env
HOST=0.0.0.0
PORT=8000
DEBUG=true
MODEL_PATH=models/yolov8_floor_plan.pt
CONFIDENCE_THRESHOLD=0.5
USE_GPU=false
LOG_LEVEL=INFO
```

## 开发计划

### 第一阶段：基础功能 ✅
- [x] 搭建FastAPI框架
- [x] 实现图像预处理
- [x] 实现目标检测模块（模拟）
- [x] 实现OCR识别模块（模拟）
- [x] 实现平面图解析服务
- [x] 创建API接口

### 第二阶段：AI模型集成
- [ ] 训练YOLOv8目标检测模型
- [ ] 集成PaddleOCR
- [ ] 优化解析算法
- [ ] 提高准确率

### 第三阶段：性能优化
- [ ] 添加缓存机制
- [ ] 优化图像处理流程
- [ ] 支持批量处理
- [ ] 添加GPU加速

### 第四阶段：部署上线
- [ ] Docker容器化
- [ ] CI/CD流程
- [ ] 生产环境部署
- [ ] 监控和日志

## 注意事项

1. **模型训练**：当前使用模拟数据，生产环境需要训练真实的YOLOv8模型
2. **性能优化**：大图处理可能需要较长时间，建议添加进度提示
3. **错误处理**：API已包含基本错误处理，建议前端做好容错
4. **安全性**：生产环境需要添加身份验证和访问控制

## 许可证

MIT License
