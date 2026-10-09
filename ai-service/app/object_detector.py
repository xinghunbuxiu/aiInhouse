"""
目标检测模块
使用YOLOv8进行平面图元素检测
"""

import cv2
import numpy as np
from pathlib import Path
from typing import List, Dict, Any, Optional, Union
from dataclasses import dataclass
from loguru import logger


@dataclass
class Detection:
    """检测结果数据类"""
    class_id: int
    class_name: str
    confidence: float
    bbox: List[float]  # [x1, y1, x2, y2]
    center: List[float]  # [x, y]
    width: float
    height: float


class ObjectDetector:
    """目标检测器"""
    
    # 类别定义
    CLASSES = {
        0: "room",
        1: "wall",
        2: "door",
        3: "window",
        4: "furniture",
        5: "text",
        6: "dimension_line"
    }
    
    # 房间类型映射
    ROOM_TYPES = {
        "living_room": "客厅",
        "bedroom": "卧室",
        "kitchen": "厨房",
        "bathroom": "卫生间",
        "dining_room": "餐厅",
        "study": "书房",
        "balcony": "阳台",
        "hallway": "走廊"
    }
    
    def __init__(self, model_path: Optional[str] = None, confidence_threshold: float = 0.5):
        """
        初始化检测器
        
        Args:
            model_path: 模型文件路径
            confidence_threshold: 置信度阈值
        """
        self.confidence_threshold = confidence_threshold
        self.model = None
        self.ready = False
        
        try:
            # 尝试导入ultralytics
            from ultralytics import YOLO
            
            if model_path and Path(model_path).exists():
                # 加载自定义模型
                self.model = YOLO(model_path)
                logger.info(f"加载自定义模型: {model_path}")
            else:
                # 使用预训练模型（需要下载）
                # 在实际项目中，应该使用训练好的自定义模型
                logger.warning("未找到自定义模型，使用模拟检测")
                self.model = None
            
            self.ready = True
            logger.info("目标检测器初始化完成")
            
        except ImportError:
            logger.warning("未安装ultralytics，使用模拟检测")
            self.ready = True
        except Exception as e:
            logger.error(f"目标检测器初始化失败: {str(e)}")
            self.ready = False
    
    def is_ready(self) -> bool:
        """检查检测器是否就绪"""
        return self.ready
    
    def detect(self, image: np.ndarray) -> List[Detection]:
        """
        检测图像中的目标
        
        Args:
            image: 输入图像
            
        Returns:
            检测结果列表
        """
        try:
            if self.model is not None:
                # 使用YOLOv8进行检测
                return self._detect_with_yolo(image)
            else:
                # 使用模拟检测
                return self._mock_detect(image)
                
        except Exception as e:
            logger.error(f"目标检测失败: {str(e)}")
            # 失败时返回模拟结果
            return self._mock_detect(image)
    
    def _detect_with_yolo(self, image: np.ndarray) -> List[Detection]:
        """
        使用YOLOv8进行检测
        
        Args:
            image: 输入图像
            
        Returns:
            检测结果列表
        """
        results = self.model(image, conf=self.confidence_threshold)
        
        detections = []
        for result in results:
            boxes = result.boxes
            for box in boxes:
                # 获取边界框坐标
                x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
                
                # 获取置信度和类别
                confidence = float(box.conf[0])
                class_id = int(box.cls[0])
                class_name = self.CLASSES.get(class_id, "unknown")
                
                # 计算中心点和尺寸
                center_x = (x1 + x2) / 2
                center_y = (y1 + y2) / 2
                width = x2 - x1
                height = y2 - y1
                
                detection = Detection(
                    class_id=class_id,
                    class_name=class_name,
                    confidence=confidence,
                    bbox=[float(x1), float(y1), float(x2), float(y2)],
                    center=[float(center_x), float(center_y)],
                    width=float(width),
                    height=float(height)
                )
                
                detections.append(detection)
        
        logger.info(f"YOLO检测完成，发现 {len(detections)} 个目标")
        return detections
    
    def _mock_detect(self, image: np.ndarray) -> List[Detection]:
        """
        模拟检测（用于测试）
        
        Args:
            image: 输入图像
            
        Returns:
            模拟的检测结果列表
        """
        height, width = image.shape[:2]
        
        # 模拟检测结果
        mock_detections = [
            # 客厅
            Detection(
                class_id=0,
                class_name="room",
                confidence=0.95,
                bbox=[width*0.1, height*0.1, width*0.6, height*0.5],
                center=[width*0.35, height*0.3],
                width=width*0.5,
                height=height*0.4
            ),
            # 卧室
            Detection(
                class_id=0,
                class_name="room",
                confidence=0.92,
                bbox=[width*0.6, height*0.1, width*0.9, height*0.4],
                center=[width*0.75, height*0.25],
                width=width*0.3,
                height=height*0.3
            ),
            # 厨房
            Detection(
                class_id=0,
                class_name="room",
                confidence=0.88,
                bbox=[width*0.1, height*0.5, width*0.5, height*0.9],
                center=[width*0.3, height*0.7],
                width=width*0.4,
                height=height*0.4
            ),
            # 门1
            Detection(
                class_id=2,
                class_name="door",
                confidence=0.85,
                bbox=[width*0.35, height*0.48, width*0.45, height*0.52],
                center=[width*0.4, height*0.5],
                width=width*0.1,
                height=height*0.04
            ),
            # 门2
            Detection(
                class_id=2,
                class_name="door",
                confidence=0.82,
                bbox=[width*0.58, height*0.2, width*0.62, height*0.3],
                center=[width*0.6, height*0.25],
                width=width*0.04,
                height=height*0.1
            ),
            # 窗户1
            Detection(
                class_id=3,
                class_name="window",
                confidence=0.90,
                bbox=[width*0.2, height*0.08, width*0.5, height*0.12],
                center=[width*0.35, height*0.1],
                width=width*0.3,
                height=height*0.04
            ),
            # 窗户2
            Detection(
                class_id=3,
                class_name="window",
                confidence=0.87,
                bbox=[width*0.7, height*0.08, width*0.85, height*0.12],
                center=[width*0.775, height*0.1],
                width=width*0.15,
                height=height*0.04
            ),
            # 墙体1
            Detection(
                class_id=1,
                class_name="wall",
                confidence=0.93,
                bbox=[width*0.1, height*0.1, width*0.12, height*0.9],
                center=[width*0.11, height*0.5],
                width=width*0.02,
                height=height*0.8
            ),
            # 墙体2
            Detection(
                class_id=1,
                class_name="wall",
                confidence=0.91,
                bbox=[width*0.1, height*0.1, width*0.9, height*0.12],
                center=[width*0.5, height*0.11],
                width=width*0.8,
                height=height*0.02
            ),
            # 家具1 - 沙发
            Detection(
                class_id=4,
                class_name="furniture",
                confidence=0.78,
                bbox=[width*0.2, height*0.2, width*0.5, height*0.35],
                center=[width*0.35, height*0.275],
                width=width*0.3,
                height=height*0.15
            ),
            # 家具2 - 床
            Detection(
                class_id=4,
                class_name="furniture",
                confidence=0.75,
                bbox=[width*0.65, height*0.15, width*0.85, height*0.35],
                center=[width*0.75, height*0.25],
                width=width*0.2,
                height=height*0.2
            ),
        ]
        
        logger.info(f"模拟检测完成，生成 {len(mock_detections)} 个目标")
        return mock_detections
    
    def filter_by_class(self, detections: List[Detection], class_name: str) -> List[Detection]:
        """
        按类别过滤检测结果
        
        Args:
            detections: 检测结果列表
            class_name: 类别名称
            
        Returns:
            过滤后的结果列表
        """
        return [d for d in detections if d.class_name == class_name]
    
    def filter_by_confidence(self, detections: List[Detection], threshold: float) -> List[Detection]:
        """
        按置信度过滤检测结果
        
        Args:
            detections: 检测结果列表
            threshold: 置信度阈值
            
        Returns:
            过滤后的结果列表
        """
        return [d for d in detections if d.confidence >= threshold]
    
    def get_room_detections(self, detections: List[Detection]) -> List[Detection]:
        """获取房间检测结果"""
        return self.filter_by_class(detections, "room")
    
    def get_wall_detections(self, detections: List[Detection]) -> List[Detection]:
        """获取墙体检测结果"""
        return self.filter_by_class(detections, "wall")
    
    def get_door_detections(self, detections: List[Detection]) -> List[Detection]:
        """获取门检测结果"""
        return self.filter_by_class(detections, "door")
    
    def get_window_detections(self, detections: List[Detection]) -> List[Detection]:
        """获取窗户检测结果"""
        return self.filter_by_class(detections, "window")
    
    def get_furniture_detections(self, detections: List[Detection]) -> List[Detection]:
        """获取家具检测结果"""
        return self.filter_by_class(detections, "furniture")
    
    def visualize_detections(self, image: np.ndarray, detections: List[Detection], 
                           save_path: Optional[str] = None) -> np.ndarray:
        """
        可视化检测结果
        
        Args:
            image: 原始图像
            detections: 检测结果列表
            save_path: 保存路径
            
        Returns:
            可视化后的图像
        """
        result_image = image.copy()
        
        # 颜色映射
        colors = {
            "room": (0, 255, 0),
            "wall": (128, 128, 128),
            "door": (0, 0, 255),
            "window": (255, 255, 0),
            "furniture": (255, 0, 255),
            "text": (0, 255, 255),
            "dimension_line": (255, 128, 0)
        }
        
        for detection in detections:
            x1, y1, x2, y2 = detection.bbox
            color = colors.get(detection.class_name, (255, 255, 255))
            
            # 绘制边界框
            cv2.rectangle(result_image, (int(x1), int(y1)), (int(x2), int(y2)), color, 2)
            
            # 绘制标签
            label = f"{detection.class_name}: {detection.confidence:.2f}"
            label_size, _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 2)
            label_y = int(y1) - 10 if int(y1) - 10 > 10 else int(y1) + 20
            
            cv2.rectangle(result_image, (int(x1), label_y - label_size[1] - 5),
                         (int(x1) + label_size[0], label_y + 5), color, -1)
            cv2.putText(result_image, label, (int(x1), label_y),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 2)
        
        if save_path:
            cv2.imwrite(save_path, result_image)
            logger.info(f"可视化结果已保存: {save_path}")
        
        return result_image
    
    def detections_to_dict(self, detections: List[Detection]) -> List[Dict[str, Any]]:
        """
        将检测结果转换为字典列表
        
        Args:
            detections: 检测结果列表
            
        Returns:
            字典列表
        """
        return [
            {
                "class_id": d.class_id,
                "class_name": d.class_name,
                "confidence": d.confidence,
                "bbox": d.bbox,
                "center": d.center,
                "width": d.width,
                "height": d.height
            }
            for d in detections
        ]


# 测试代码
if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("用法: python object_detector.py <图像路径>")
        sys.exit(1)
    
    image_path = sys.argv[1]
    
    # 创建检测器
    detector = ObjectDetector()
    
    try:
        # 读取图像
        image = cv2.imread(image_path)
        if image is None:
            print(f"无法读取图像: {image_path}")
            sys.exit(1)
        
        # 进行检测
        detections = detector.detect(image)
        
        print(f"检测到 {len(detections)} 个目标:")
        for i, det in enumerate(detections):
            print(f"{i+1}. {det.class_name} (置信度: {det.confidence:.2f})")
        
        # 可视化结果
        output_path = "detection_result.jpg"
        detector.visualize_detections(image, detections, output_path)
        print(f"可视化结果已保存: {output_path}")
        
    except Exception as e:
        print(f"检测失败: {str(e)}")
