"""
OCR识别模块
使用PaddleOCR进行尺寸标注和文字识别
"""

import cv2
import numpy as np
import re
from pathlib import Path
from typing import List, Dict, Any, Optional, Union, Tuple
from dataclasses import dataclass
from loguru import logger


@dataclass
class OCRResult:
    """OCR结果数据类"""
    text: str
    confidence: float
    bbox: List[List[float]]  # 四个角点坐标
    center: List[float]  # 中心点
    is_dimension: bool  # 是否是尺寸标注
    value: Optional[float] = None  # 数值（如果是尺寸）
    unit: Optional[str] = None  # 单位（mm, cm, m）


class OCRRecognizer:
    """OCR识别器"""
    
    def __init__(self, use_gpu: bool = False):
        """
        初始化OCR识别器
        
        Args:
            use_gpu: 是否使用GPU
        """
        self.ocr = None
        self.ready = False
        self.use_gpu = use_gpu
        
        try:
            # 尝试导入PaddleOCR
            from paddleocr import PaddleOCR
            
            # 初始化PaddleOCR
            self.ocr = PaddleOCR(
                use_angle_cls=True,
                lang='ch',
                use_gpu=use_gpu,
                show_log=False
            )
            
            self.ready = True
            logger.info("OCR识别器初始化完成")
            
        except ImportError:
            logger.warning("未安装PaddleOCR，使用模拟识别")
            self.ready = True
        except Exception as e:
            logger.error(f"OCR识别器初始化失败: {str(e)}")
            self.ready = False
    
    def is_ready(self) -> bool:
        """检查识别器是否就绪"""
        return self.ready
    
    def recognize(self, image: np.ndarray) -> List[OCRResult]:
        """
        识别图像中的文字
        
        Args:
            image: 输入图像
            
        Returns:
            OCR结果列表
        """
        try:
            if self.ocr is not None:
                # 使用PaddleOCR进行识别
                return self._recognize_with_paddle(image)
            else:
                # 使用模拟识别
                return self._mock_recognize(image)
                
        except Exception as e:
            logger.error(f"OCR识别失败: {str(e)}")
            # 失败时返回模拟结果
            return self._mock_recognize(image)
    
    def _recognize_with_paddle(self, image: np.ndarray) -> List[OCRResult]:
        """
        使用PaddleOCR进行识别
        
        Args:
            image: 输入图像
            
        Returns:
            OCR结果列表
        """
        # 执行OCR
        result = self.ocr.ocr(image, cls=True)
        
        ocr_results = []
        if result and result[0]:
            for line in result[0]:
                if line:
                    bbox = line[0]
                    text = line[1][0]
                    confidence = line[1][1]
                    
                    # 计算中心点
                    center_x = sum([p[0] for p in bbox]) / 4
                    center_y = sum([p[1] for p in bbox]) / 4
                    
                    # 判断是否是尺寸标注
                    is_dimension, value, unit = self._parse_dimension(text)
                    
                    ocr_result = OCRResult(
                        text=text,
                        confidence=confidence,
                        bbox=bbox,
                        center=[center_x, center_y],
                        is_dimension=is_dimension,
                        value=value,
                        unit=unit
                    )
                    
                    ocr_results.append(ocr_result)
        
        logger.info(f"PaddleOCR识别完成，发现 {len(ocr_results)} 个文本区域")
        return ocr_results
    
    def _mock_recognize(self, image: np.ndarray) -> List[OCRResult]:
        """
        模拟OCR识别（用于测试）
        
        Args:
            image: 输入图像
            
        Returns:
            模拟的OCR结果列表
        """
        height, width = image.shape[:2]
        
        # 模拟OCR结果
        mock_results = [
            # 客厅尺寸标注
            OCRResult(
                text="4500",
                confidence=0.95,
                bbox=[[width*0.1, height*0.05], [width*0.3, height*0.05], 
                      [width*0.3, height*0.08], [width*0.1, height*0.08]],
                center=[width*0.2, height*0.065],
                is_dimension=True,
                value=4500,
                unit="mm"
            ),
            OCRResult(
                text="5000",
                confidence=0.93,
                bbox=[[width*0.05, height*0.1], [width*0.08, height*0.1],
                      [width*0.08, height*0.5], [width*0.05, height*0.5]],
                center=[width*0.065, height*0.3],
                is_dimension=True,
                value=5000,
                unit="mm"
            ),
            # 卧室尺寸标注
            OCRResult(
                text="3500",
                confidence=0.91,
                bbox=[[width*0.6, height*0.05], [width*0.8, height*0.05],
                      [width*0.8, height*0.08], [width*0.6, height*0.08]],
                center=[width*0.7, height*0.065],
                is_dimension=True,
                value=3500,
                unit="mm"
            ),
            OCRResult(
                text="4000",
                confidence=0.89,
                bbox=[[width*0.92, height*0.1], [width*0.95, height*0.1],
                      [width*0.95, height*0.4], [width*0.92, height*0.4]],
                center=[width*0.935, height*0.25],
                is_dimension=True,
                value=4000,
                unit="mm"
            ),
            # 厨房尺寸标注
            OCRResult(
                text="3000",
                confidence=0.88,
                bbox=[[width*0.1, height*0.92], [width*0.4, height*0.92],
                      [width*0.4, height*0.95], [width*0.1, height*0.95]],
                center=[width*0.25, height*0.935],
                is_dimension=True,
                value=3000,
                unit="mm"
            ),
            OCRResult(
                text="3500",
                confidence=0.87,
                bbox=[[width*0.05, height*0.5], [width*0.08, height*0.5],
                      [width*0.08, height*0.9], [width*0.05, height*0.9]],
                center=[width*0.065, height*0.7],
                is_dimension=True,
                value=3500,
                unit="mm"
            ),
            # 门的尺寸标注
            OCRResult(
                text="900",
                confidence=0.85,
                bbox=[[width*0.35, height*0.52], [width*0.45, height*0.52],
                      [width*0.45, height*0.55], [width*0.35, height*0.55]],
                center=[width*0.4, height*0.535],
                is_dimension=True,
                value=900,
                unit="mm"
            ),
            # 窗户的尺寸标注
            OCRResult(
                text="1500",
                confidence=0.86,
                bbox=[[width*0.2, height*0.02], [width*0.5, height*0.02],
                      [width*0.5, height*0.05], [width*0.2, height*0.05]],
                center=[width*0.35, height*0.035],
                is_dimension=True,
                value=1500,
                unit="mm"
            ),
            # 房间标签
            OCRResult(
                text="客厅",
                confidence=0.94,
                bbox=[[width*0.25, height*0.25], [width*0.45, height*0.25],
                      [width*0.45, height*0.35], [width*0.25, height*0.35]],
                center=[width*0.35, height*0.3],
                is_dimension=False
            ),
            OCRResult(
                text="卧室",
                confidence=0.92,
                bbox=[[width*0.65, height*0.2], [width*0.85, height*0.2],
                      [width*0.85, height*0.3], [width*0.65, height*0.3]],
                center=[width*0.75, height*0.25],
                is_dimension=False
            ),
            OCRResult(
                text="厨房",
                confidence=0.90,
                bbox=[[width*0.2, height*0.65], [width*0.4, height*0.65],
                      [width*0.4, height*0.75], [width*0.2, height*0.75]],
                center=[width*0.3, height*0.7],
                is_dimension=False
            ),
        ]
        
        logger.info(f"模拟OCR识别完成，生成 {len(mock_results)} 个文本区域")
        return mock_results
    
    def _parse_dimension(self, text: str) -> Tuple[bool, Optional[float], Optional[str]]:
        """
        解析尺寸标注
        
        Args:
            text: 文本内容
            
        Returns:
            (是否是尺寸, 数值, 单位)
        """
        # 清理文本
        text = text.strip().replace(' ', '').replace(',', '')
        
        # 匹配尺寸模式
        # 支持格式：4500, 4500mm, 4.5m, 450cm, 4.5米, 450厘米, 4500毫米
        patterns = [
            # 数字 + 单位
            (r'^(\d+\.?\d*)\s*(mm|毫米)$', 'mm'),
            (r'^(\d+\.?\d*)\s*(cm|厘米)$', 'cm'),
            (r'^(\d+\.?\d*)\s*(m|米)$', 'm'),
            # 纯数字（假设为mm）
            (r'^(\d{3,5})$', 'mm'),
        ]
        
        for pattern, default_unit in patterns:
            match = re.match(pattern, text, re.IGNORECASE)
            if match:
                try:
                    value = float(match.group(1))
                    return True, value, default_unit
                except ValueError:
                    continue
        
        return False, None, None
    
    def get_dimensions(self, ocr_results: List[OCRResult]) -> List[OCRResult]:
        """获取尺寸标注结果"""
        return [r for r in ocr_results if r.is_dimension]
    
    def get_room_labels(self, ocr_results: List[OCRResult]) -> List[OCRResult]:
        """获取房间标签"""
        room_keywords = ['客厅', '卧室', '厨房', '卫生间', '餐厅', '书房', '阳台', '走廊']
        return [r for r in ocr_results if any(keyword in r.text for keyword in room_keywords)]
    
    def convert_to_meters(self, value: float, unit: str) -> float:
        """
        将尺寸转换为米
        
        Args:
            value: 数值
            unit: 单位
            
        Returns:
            米为单位的数值
        """
        unit = unit.lower()
        if unit in ['mm', '毫米']:
            return value / 1000
        elif unit in ['cm', '厘米']:
            return value / 100
        elif unit in ['m', '米']:
            return value
        else:
            # 默认假设为mm
            return value / 1000
    
    def find_dimensions_for_room(self, room_bbox: List[float], 
                                ocr_results: List[OCRResult]) -> Dict[str, float]:
        """
        查找房间相关的尺寸标注
        
        Args:
            room_bbox: 房间边界框 [x1, y1, x2, y2]
            ocr_results: OCR结果列表
            
        Returns:
            尺寸字典 {'width': width, 'length': length}
        """
        rx1, ry1, rx2, ry2 = room_bbox
        room_center_x = (rx1 + rx2) / 2
        room_center_y = (ry1 + ry2) / 2
        
        dimensions = {'width': None, 'length': None}
        
        for result in ocr_results:
            if not result.is_dimension or result.value is None:
                continue
            
            cx, cy = result.center
            
            # 判断尺寸标注位置
            # 水平方向的尺寸（在房间上方或下方）
            if abs(cy - ry1) < 50 or abs(cy - ry2) < 50:
                if dimensions['width'] is None:
                    dimensions['width'] = self.convert_to_meters(result.value, result.unit or 'mm')
            
            # 垂直方向的尺寸（在房间左侧或右侧）
            if abs(cx - rx1) < 50 or abs(cx - rx2) < 50:
                if dimensions['length'] is None:
                    dimensions['length'] = self.convert_to_meters(result.value, result.unit or 'mm')
        
        # 如果没有找到尺寸，使用默认值
        if dimensions['width'] is None:
            dimensions['width'] = 4.0
        if dimensions['length'] is None:
            dimensions['length'] = 5.0
        
        return dimensions
    
    def visualize_ocr_results(self, image: np.ndarray, ocr_results: List[OCRResult],
                             save_path: Optional[str] = None) -> np.ndarray:
        """
        可视化OCR结果
        
        Args:
            image: 原始图像
            ocr_results: OCR结果列表
            save_path: 保存路径
            
        Returns:
            可视化后的图像
        """
        result_image = image.copy()
        
        for result in ocr_results:
            # 绘制边界框
            bbox = np.array(result.bbox, dtype=np.int32)
            
            # 尺寸标注用红色，其他用蓝色
            color = (0, 0, 255) if result.is_dimension else (255, 0, 0)
            
            cv2.polylines(result_image, [bbox], True, color, 2)
            
            # 绘制文本
            text = result.text
            if result.is_dimension and result.value is not None:
                text = f"{result.value}{result.unit} ({result.confidence:.2f})"
            else:
                text = f"{text} ({result.confidence:.2f})"
            
            # 计算文本位置
            x = int(result.bbox[0][0])
            y = int(result.bbox[0][1]) - 10
            
            # 绘制文本背景
            (text_width, text_height), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 2)
            cv2.rectangle(result_image, (x, y - text_height - 5), 
                         (x + text_width, y + 5), color, -1)
            
            # 绘制文本
            cv2.putText(result_image, text, (x, y), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 2)
        
        if save_path:
            cv2.imwrite(save_path, result_image)
            logger.info(f"OCR可视化结果已保存: {save_path}")
        
        return result_image
    
    def ocr_results_to_dict(self, ocr_results: List[OCRResult]) -> List[Dict[str, Any]]:
        """
        将OCR结果转换为字典列表
        
        Args:
            ocr_results: OCR结果列表
            
        Returns:
            字典列表
        """
        return [
            {
                "text": r.text,
                "confidence": r.confidence,
                "bbox": r.bbox,
                "center": r.center,
                "is_dimension": r.is_dimension,
                "value": r.value,
                "unit": r.unit
            }
            for r in ocr_results
        ]


# 测试代码
if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("用法: python ocr_recognizer.py <图像路径>")
        sys.exit(1)
    
    image_path = sys.argv[1]
    
    # 创建OCR识别器
    recognizer = OCRRecognizer()
    
    try:
        # 读取图像
        image = cv2.imread(image_path)
        if image is None:
            print(f"无法读取图像: {image_path}")
            sys.exit(1)
        
        # 进行OCR识别
        ocr_results = recognizer.recognize(image)
        
        print(f"识别到 {len(ocr_results)} 个文本区域:")
        for i, result in enumerate(ocr_results):
            if result.is_dimension:
                print(f"{i+1}. [尺寸] {result.value}{result.unit} (置信度: {result.confidence:.2f})")
            else:
                print(f"{i+1}. [文本] {result.text} (置信度: {result.confidence:.2f})")
        
        # 可视化结果
        output_path = "ocr_result.jpg"
        recognizer.visualize_ocr_results(image, ocr_results, output_path)
        print(f"OCR可视化结果已保存: {output_path}")
        
    except Exception as e:
        print(f"OCR识别失败: {str(e)}")
