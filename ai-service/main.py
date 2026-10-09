"""
AI平面图解析服务
使用FastAPI构建，提供平面图解析API
"""

import os
import sys
from pathlib import Path
from typing import Optional
from datetime import datetime

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from loguru import logger

# 添加app目录到路径
sys.path.append(str(Path(__file__).parent / "app"))

from app.image_processor import ImageProcessor
from app.object_detector import ObjectDetector
from app.ocr_recognizer import OCRRecognizer
from app.floor_plan_parser import FloorPlanParser

# 配置日志
logger.add("logs/ai_service.log", rotation="500 MB", level="INFO")

# 创建FastAPI应用
app = FastAPI(
    title="AI平面图解析服务",
    description="使用YOLOv8和PaddleOCR实现的家装平面图智能解析服务",
    version="1.0.0"
)

# 配置CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 生产环境应该限制具体域名
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 创建日志目录
os.makedirs("logs", exist_ok=True)
os.makedirs("uploads", exist_ok=True)

# 初始化组件
image_processor = ImageProcessor()
object_detector = ObjectDetector()
ocr_recognizer = OCRRecognizer()
floor_plan_parser = FloorPlanParser()


# 数据模型
class ParseResult(BaseModel):
    success: bool
    message: str
    data: Optional[dict] = None
    processing_time: float
    
    class Config:
        arbitrary_types_allowed = True


class HealthCheck(BaseModel):
    status: str
    timestamp: str
    version: str
    
    class Config:
        arbitrary_types_allowed = True


@app.get("/", response_model=HealthCheck)
async def root():
    """根路径，返回服务状态"""
    return HealthCheck(
        status="running",
        timestamp=datetime.now().isoformat(),
        version="1.0.0"
    )


@app.get("/health")
async def health_check():
    """健康检查接口"""
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "services": {
            "image_processor": image_processor.is_ready(),
            "object_detector": object_detector.is_ready(),
            "ocr_recognizer": ocr_recognizer.is_ready()
        }
    }


@app.post("/api/parse", response_model=ParseResult)
async def parse_floor_plan(file: UploadFile = File(...)):
    """
    解析平面图API
    
    - **file**: 上传的平面图文件（支持JPG、PNG、PDF格式）
    
    返回解析结果，包含房间、墙体、门窗等元素信息
    """
    import time
    start_time = time.time()
    
    try:
        # 验证文件类型
        allowed_types = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf']
        if file.content_type not in allowed_types:
            raise HTTPException(
                status_code=400, 
                detail=f"不支持的文件类型: {file.content_type}"
            )
        
        # 保存上传的文件
        file_path = f"uploads/{datetime.now().strftime('%Y%m%d_%H%M%S')}_{file.filename}"
        with open(file_path, "wb") as buffer:
            content = await file.read()
            buffer.write(content)
        
        logger.info(f"接收到文件: {file.filename}, 保存到: {file_path}")
        
        # 图像预处理
        logger.info("开始图像预处理...")
        processed_image = image_processor.process(file_path)
        
        # 目标检测
        logger.info("开始目标检测...")
        detections = object_detector.detect(processed_image)
        
        # OCR识别
        logger.info("开始OCR识别...")
        ocr_results = ocr_recognizer.recognize(processed_image)
        
        # 解析平面图
        logger.info("开始解析平面图...")
        parse_result = floor_plan_parser.parse(detections, ocr_results)
        
        # 计算处理时间
        processing_time = time.time() - start_time
        
        # 清理上传的文件
        os.remove(file_path)
        
        logger.info(f"解析完成，耗时: {processing_time:.2f}秒")
        
        return ParseResult(
            success=True,
            message="解析成功",
            data=parse_result,
            processing_time=processing_time
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"解析失败: {str(e)}")
        processing_time = time.time() - start_time
        return ParseResult(
            success=False,
            message=f"解析失败: {str(e)}",
            data=None,
            processing_time=processing_time
        )


@app.post("/api/parse/mock")
async def parse_floor_plan_mock(file: UploadFile = File(...)):
    """
    模拟解析API（用于测试）
    
    - **file**: 上传的平面图文件
    
    返回模拟的解析结果
    """
    import time
    start_time = time.time()
    
    try:
        # 模拟处理时间
        time.sleep(1)
        
        # 模拟解析结果
        mock_result = {
            "rooms": [
                {
                    "id": 1,
                    "name": "客厅",
                    "type": "living_room",
                    "width": 4.5,
                    "length": 5.0,
                    "area": 22.5,
                    "walls": [
                        {"id": 1, "length": 5.0, "type": "exterior", "thickness": 0.2},
                        {"id": 2, "length": 4.5, "type": "interior", "thickness": 0.1},
                        {"id": 3, "length": 5.0, "type": "exterior", "thickness": 0.2},
                        {"id": 4, "length": 4.5, "type": "interior", "thickness": 0.1}
                    ],
                    "doors": [
                        {"id": 1, "position": {"x": 2.25, "y": 0}, "width": 0.9, "height": 2.1, "type": "entrance"}
                    ],
                    "windows": [
                        {"id": 1, "position": {"x": 1.5, "y": 5.0}, "width": 1.5, "height": 1.2, "type": "normal"},
                        {"id": 2, "position": {"x": 3.0, "y": 5.0}, "width": 1.5, "height": 1.2, "type": "normal"}
                    ],
                    "furniture": [
                        {"id": 1, "type": "sofa", "position": {"x": 2.25, "y": 1.5}, "width": 2.0, "length": 0.8},
                        {"id": 2, "type": "tv", "position": {"x": 2.25, "y": 4.0}, "width": 1.2, "length": 0.1}
                    ]
                },
                {
                    "id": 2,
                    "name": "卧室",
                    "type": "bedroom",
                    "width": 3.5,
                    "length": 4.0,
                    "area": 14.0,
                    "walls": [
                        {"id": 5, "length": 4.0, "type": "interior", "thickness": 0.1},
                        {"id": 6, "length": 3.5, "type": "exterior", "thickness": 0.2},
                        {"id": 7, "length": 4.0, "type": "interior", "thickness": 0.1},
                        {"id": 8, "length": 3.5, "type": "exterior", "thickness": 0.2}
                    ],
                    "doors": [
                        {"id": 2, "position": {"x": 1.75, "y": 0}, "width": 0.9, "height": 2.1, "type": "interior"}
                    ],
                    "windows": [
                        {"id": 3, "position": {"x": 1.0, "y": 4.0}, "width": 1.5, "height": 1.2, "type": "normal"}
                    ],
                    "furniture": [
                        {"id": 3, "type": "bed", "position": {"x": 1.75, "y": 2.0}, "width": 1.8, "length": 2.0},
                        {"id": 4, "type": "wardrobe", "position": {"x": 0.5, "y": 3.5}, "width": 1.0, "length": 0.6}
                    ]
                },
                {
                    "id": 3,
                    "name": "厨房",
                    "type": "kitchen",
                    "width": 3.0,
                    "length": 3.5,
                    "area": 10.5,
                    "walls": [
                        {"id": 9, "length": 3.5, "type": "interior", "thickness": 0.1},
                        {"id": 10, "length": 3.0, "type": "exterior", "thickness": 0.2},
                        {"id": 11, "length": 3.5, "type": "interior", "thickness": 0.1},
                        {"id": 12, "length": 3.0, "type": "exterior", "thickness": 0.2}
                    ],
                    "doors": [
                        {"id": 3, "position": {"x": 1.5, "y": 0}, "width": 0.9, "height": 2.1, "type": "interior"}
                    ],
                    "windows": [
                        {"id": 4, "position": {"x": 0.75, "y": 3.5}, "width": 1.5, "height": 1.2, "type": "normal"}
                    ],
                    "furniture": [
                        {"id": 5, "type": "cabinet", "position": {"x": 1.5, "y": 0.5}, "width": 2.0, "length": 0.6},
                        {"id": 6, "type": "fridge", "position": {"x": 2.5, "y": 1.5}, "width": 0.8, "length": 0.6}
                    ]
                }
            ],
            "total_area": 47.0,
            "dimensions": {
                "width": 11.0,
                "length": 12.5
            }
        }
        
        processing_time = time.time() - start_time
        
        return ParseResult(
            success=True,
            message="模拟解析成功",
            data=mock_result,
            processing_time=processing_time
        )
        
    except Exception as e:
        processing_time = time.time() - start_time
        return ParseResult(
            success=False,
            message=f"模拟解析失败: {str(e)}",
            data=None,
            processing_time=processing_time
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
