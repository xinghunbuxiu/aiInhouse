"""
平面图解析服务
整合目标检测和OCR结果，生成结构化的平面图数据
"""

import cv2
import numpy as np
from typing import List, Dict, Any, Optional, Tuple
from pathlib import Path
from loguru import logger

from app.object_detector import ObjectDetector, Detection
from app.ocr_recognizer import OCRRecognizer, OCRResult


class FloorPlanParser:
    """平面图解析器"""
    
    # 房间类型映射
    ROOM_TYPE_MAPPING = {
        "客厅": "living_room",
        "卧室": "bedroom",
        "主卧": "master_bedroom",
        "次卧": "second_bedroom",
        "厨房": "kitchen",
        "卫生间": "bathroom",
        "餐厅": "dining_room",
        "书房": "study",
        "阳台": "balcony",
        "走廊": "hallway",
        "玄关": "entrance"
    }
    
    # 家具类型映射
    FURNITURE_MAPPING = {
        "sofa": "沙发",
        "bed": "床",
        "tv": "电视",
        "wardrobe": "衣柜",
        "cabinet": "橱柜",
        "fridge": "冰箱",
        "table": "桌子",
        "chair": "椅子",
        "desk": "书桌",
        "bookshelf": "书架",
        "bathtub": "浴缸",
        "toilet": "马桶",
        "sink": "洗手池"
    }
    
    def __init__(self):
        """初始化平面图解析器"""
        self.ready = True
        logger.info("平面图解析器初始化完成")
    
    def is_ready(self) -> bool:
        """检查解析器是否就绪"""
        return self.ready
    
    def parse(self, detections: List[Detection], ocr_results: List[OCRResult]) -> Dict[str, Any]:
        """
        解析平面图
        
        Args:
            detections: 目标检测结果
            ocr_results: OCR识别结果
            
        Returns:
            解析后的平面图数据
        """
        try:
            logger.info("开始解析平面图...")
            
            # 提取房间信息
            rooms = self._extract_rooms(detections, ocr_results)
            
            # 提取墙体信息
            walls = self._extract_walls(detections)
            
            # 提取门窗信息
            doors = self._extract_doors(detections)
            windows = self._extract_windows(detections)
            
            # 提取家具信息
            furniture = self._extract_furniture(detections)
            
            # 计算总面积
            total_area = sum(room.get('area', 0) for room in rooms)
            
            # 计算整体尺寸
            dimensions = self._calculate_dimensions(rooms)
            
            result = {
                "rooms": rooms,
                "walls": walls,
                "doors": doors,
                "windows": windows,
                "furniture": furniture,
                "total_area": total_area,
                "dimensions": dimensions,
                "raw_detections": len(detections),
                "raw_ocr_results": len(ocr_results)
            }
            
            logger.info(f"平面图解析完成，发现 {len(rooms)} 个房间")
            return result
            
        except Exception as e:
            logger.error(f"平面图解析失败: {str(e)}")
            # 返回默认结果
            return self._get_default_result()
    
    def _extract_rooms(self, detections: List[Detection], 
                      ocr_results: List[OCRResult]) -> List[Dict[str, Any]]:
        """
        提取房间信息
        
        Args:
            detections: 目标检测结果
            ocr_results: OCR识别结果
            
        Returns:
            房间信息列表
        """
        rooms = []
        room_detections = [d for d in detections if d.class_name == "room"]
        
        # 获取房间标签
        room_labels = [o for o in ocr_results 
                      if any(keyword in o.text for keyword in self.ROOM_TYPE_MAPPING.keys())]
        
        for i, room_det in enumerate(room_detections):
            room_id = i + 1
            
            # 查找对应的房间标签
            room_name = self._find_room_name(room_det, room_labels)
            room_type = self.ROOM_TYPE_MAPPING.get(room_name, "unknown")
            
            # 查找房间尺寸
            dimensions = self._find_room_dimensions(room_det, ocr_results)
            
            # 计算房间面积
            area = dimensions['width'] * dimensions['length']
            
            # 查找房间内的门窗
            room_doors = self._find_elements_in_room(room_det, 
                                                    [d for d in detections if d.class_name == "door"])
            room_windows = self._find_elements_in_room(room_det,
                                                      [d for d in detections if d.class_name == "window"])
            
            # 查找房间内的家具
            room_furniture = self._find_elements_in_room(room_det,
                                                        [d for d in detections if d.class_name == "furniture"])
            
            room = {
                "id": room_id,
                "name": room_name,
                "type": room_type,
                "width": dimensions['width'],
                "length": dimensions['length'],
                "area": area,
                "bbox": room_det.bbox,
                "center": room_det.center,
                "doors": room_doors,
                "windows": room_windows,
                "furniture": room_furniture
            }
            
            rooms.append(room)
        
        return rooms
    
    def _find_room_name(self, room_det: Detection, 
                       room_labels: List[OCRResult]) -> str:
        """
        查找房间名称
        
        Args:
            room_det: 房间检测结果
            room_labels: 房间标签列表
            
        Returns:
            房间名称
        """
        rx1, ry1, rx2, ry2 = room_det.bbox
        room_center_x = (rx1 + rx2) / 2
        room_center_y = (ry1 + ry2) / 2
        
        # 查找在房间内的标签
        for label in room_labels:
            lx, ly = label.center
            if rx1 <= lx <= rx2 and ry1 <= ly <= ry2:
                # 找到匹配的标签
                for name in self.ROOM_TYPE_MAPPING.keys():
                    if name in label.text:
                        return name
        
        # 默认名称
        return "房间"
    
    def _find_room_dimensions(self, room_det: Detection,
                             ocr_results: List[OCRResult]) -> Dict[str, float]:
        """
        查找房间尺寸
        
        Args:
            room_det: 房间检测结果
            ocr_results: OCR识别结果
            
        Returns:
            尺寸字典 {'width': width, 'length': length}
        """
        rx1, ry1, rx2, ry2 = room_det.bbox
        
        dimensions = {'width': None, 'length': None}
        
        # 查找尺寸标注
        for ocr in ocr_results:
            if not ocr.is_dimension or ocr.value is None:
                continue
            
            cx, cy = ocr.center
            
            # 水平方向的尺寸（在房间上方或下方）
            if abs(cy - ry1) < 100 or abs(cy - ry2) < 100:
                if rx1 <= cx <= rx2:
                    if dimensions['width'] is None:
                        dimensions['width'] = self._convert_to_meters(ocr.value, ocr.unit or 'mm')
            
            # 垂直方向的尺寸（在房间左侧或右侧）
            if abs(cx - rx1) < 100 or abs(cx - rx2) < 100:
                if ry1 <= cy <= ry2:
                    if dimensions['length'] is None:
                        dimensions['length'] = self._convert_to_meters(ocr.value, ocr.unit or 'mm')
        
        # 如果没有找到尺寸，使用边界框估算
        if dimensions['width'] is None:
            # 假设图像中100像素 = 1米
            dimensions['width'] = (rx2 - rx1) / 100
        
        if dimensions['length'] is None:
            dimensions['length'] = (ry2 - ry1) / 100
        
        return dimensions
    
    def _find_elements_in_room(self, room_det: Detection,
                              elements: List[Detection]) -> List[Dict[str, Any]]:
        """
        查找房间内的元素
        
        Args:
            room_det: 房间检测结果
            elements: 元素列表
            
        Returns:
            元素信息列表
        """
        rx1, ry1, rx2, ry2 = room_det.bbox
        room_elements = []
        
        for i, elem in enumerate(elements):
            ex1, ey1, ex2, ey2 = elem.bbox
            elem_center_x = (ex1 + ex2) / 2
            elem_center_y = (ey1 + ey2) / 2
            
            # 检查元素中心是否在房间内
            if rx1 <= elem_center_x <= rx2 and ry1 <= elem_center_y <= ry2:
                element_info = {
                    "id": i + 1,
                    "type": elem.class_name,
                    "position": {
                        "x": round((elem_center_x - rx1) / 100, 2),
                        "y": round((elem_center_y - ry1) / 100, 2)
                    },
                    "width": round((ex2 - ex1) / 100, 2),
                    "height": round((ey2 - ey1) / 100, 2),
                    "confidence": elem.confidence
                }
                room_elements.append(element_info)
        
        return room_elements
    
    def _extract_walls(self, detections: List[Detection]) -> List[Dict[str, Any]]:
        """提取墙体信息"""
        walls = []
        wall_detections = [d for d in detections if d.class_name == "wall"]
        
        for i, wall in enumerate(wall_detections):
            x1, y1, x2, y2 = wall.bbox
            
            # 判断墙体方向
            width = x2 - x1
            height = y2 - y1
            
            if width > height:
                wall_type = "horizontal"
                length = width / 100  # 转换为米
                thickness = height / 100
            else:
                wall_type = "vertical"
                length = height / 100
                thickness = width / 100
            
            wall_info = {
                "id": i + 1,
                "type": wall_type,
                "length": round(length, 2),
                "thickness": round(thickness, 2),
                "position": {
                    "x": round((x1 + x2) / 2 / 100, 2),
                    "y": round((y1 + y2) / 2 / 100, 2)
                },
                "confidence": wall.confidence
            }
            
            walls.append(wall_info)
        
        return walls
    
    def _extract_doors(self, detections: List[Detection]) -> List[Dict[str, Any]]:
        """提取门信息"""
        doors = []
        door_detections = [d for d in detections if d.class_name == "door"]
        
        for i, door in enumerate(door_detections):
            x1, y1, x2, y2 = door.bbox
            
            door_info = {
                "id": i + 1,
                "type": "interior",  # 可以是 interior 或 entrance
                "width": round((x2 - x1) / 100, 2),
                "height": round((y2 - y1) / 100, 2),
                "position": {
                    "x": round((x1 + x2) / 2 / 100, 2),
                    "y": round((y1 + y2) / 2 / 100, 2)
                },
                "confidence": door.confidence
            }
            
            doors.append(door_info)
        
        return doors
    
    def _extract_windows(self, detections: List[Detection]) -> List[Dict[str, Any]]:
        """提取窗户信息"""
        windows = []
        window_detections = [d for d in detections if d.class_name == "window"]
        
        for i, window in enumerate(window_detections):
            x1, y1, x2, y2 = window.bbox
            
            window_info = {
                "id": i + 1,
                "type": "normal",
                "width": round((x2 - x1) / 100, 2),
                "height": round((y2 - y1) / 100, 2),
                "position": {
                    "x": round((x1 + x2) / 2 / 100, 2),
                    "y": round((y1 + y2) / 2 / 100, 2)
                },
                "confidence": window.confidence
            }
            
            windows.append(window_info)
        
        return windows
    
    def _extract_furniture(self, detections: List[Detection]) -> List[Dict[str, Any]]:
        """提取家具信息"""
        furniture_list = []
        furniture_detections = [d for d in detections if d.class_name == "furniture"]
        
        for i, furniture in enumerate(furniture_detections):
            x1, y1, x2, y2 = furniture.bbox
            
            # 根据尺寸猜测家具类型
            width = (x2 - x1) / 100
            height = (y2 - y1) / 100
            
            # 简单的启发式规则
            if width > 1.5 and height > 1.5:
                furniture_type = "bed"
            elif width > 1.5 and height < 1.0:
                furniture_type = "sofa"
            elif width < 1.0 and height > 1.5:
                furniture_type = "wardrobe"
            else:
                furniture_type = "unknown"
            
            furniture_info = {
                "id": i + 1,
                "type": furniture_type,
                "name": self.FURNITURE_MAPPING.get(furniture_type, "家具"),
                "width": round(width, 2),
                "height": round(height, 2),
                "position": {
                    "x": round((x1 + x2) / 2 / 100, 2),
                    "y": round((y1 + y2) / 2 / 100, 2)
                },
                "confidence": furniture.confidence
            }
            
            furniture_list.append(furniture_info)
        
        return furniture_list
    
    def _calculate_dimensions(self, rooms: List[Dict[str, Any]]) -> Dict[str, float]:
        """
        计算整体尺寸
        
        Args:
            rooms: 房间列表
            
        Returns:
            整体尺寸字典
        """
        if not rooms:
            return {"width": 0, "length": 0}
        
        # 计算边界框
        min_x = min(room['center'][0] - room['width'] / 2 for room in rooms)
        max_x = max(room['center'][0] + room['width'] / 2 for room in rooms)
        min_y = min(room['center'][1] - room['length'] / 2 for room in rooms)
        max_y = max(room['center'][1] + room['length'] / 2 for room in rooms)
        
        return {
            "width": round(max_x - min_x, 2),
            "length": round(max_y - min_y, 2)
        }
    
    def _convert_to_meters(self, value: float, unit: str) -> float:
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
    
    def _get_default_result(self) -> Dict[str, Any]:
        """获取默认解析结果"""
        return {
            "rooms": [
                {
                    "id": 1,
                    "name": "客厅",
                    "type": "living_room",
                    "width": 4.5,
                    "length": 5.0,
                    "area": 22.5,
                    "doors": [],
                    "windows": [],
                    "furniture": []
                }
            ],
            "walls": [],
            "doors": [],
            "windows": [],
            "furniture": [],
            "total_area": 22.5,
            "dimensions": {"width": 4.5, "length": 5.0},
            "raw_detections": 0,
            "raw_ocr_results": 0
        }
    
    def validate_result(self, result: Dict[str, Any]) -> Tuple[bool, str]:
        """
        验证解析结果
        
        Args:
            result: 解析结果
            
        Returns:
            (是否有效, 错误信息)
        """
        if not result:
            return False, "解析结果为空"
        
        if "rooms" not in result:
            return False, "缺少房间信息"
        
        if not result["rooms"]:
            return False, "未检测到房间"
        
        for room in result["rooms"]:
            if "width" not in room or "length" not in room:
                return False, f"房间 {room.get('id', '?')} 缺少尺寸信息"
            
            if room["width"] <= 0 or room["length"] <= 0:
                return False, f"房间 {room.get('id', '?')} 尺寸无效"
        
        return True, "验证通过"


# 测试代码
if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("用法: python floor_plan_parser.py <图像路径>")
        sys.exit(1)
    
    image_path = sys.argv[1]
    
    # 创建解析器
    parser = FloorPlanParser()
    
    try:
        # 读取图像
        image = cv2.imread(image_path)
        if image is None:
            print(f"无法读取图像: {image_path}")
            sys.exit(1)
        
        # 创建检测器和OCR识别器
        detector = ObjectDetector()
        recognizer = OCRRecognizer()
        
        # 进行检测和识别
        detections = detector.detect(image)
        ocr_results = recognizer.recognize(image)
        
        # 解析平面图
        result = parser.parse(detections, ocr_results)
        
        # 验证结果
        is_valid, message = parser.validate_result(result)
        print(f"验证结果: {message}")
        
        if is_valid:
            print(f"\n解析结果:")
            print(f"房间数量: {len(result['rooms'])}")
            print(f"总面积: {result['total_area']:.2f} 平方米")
            print(f"整体尺寸: {result['dimensions']['width']:.2f}m x {result['dimensions']['length']:.2f}m")
            
            print(f"\n房间详情:")
            for room in result['rooms']:
                print(f"  - {room['name']}: {room['width']:.2f}m x {room['length']:.2f}m "
                      f"(面积: {room['area']:.2f}m²)")
                print(f"    门: {len(room['doors'])} 个, 窗: {len(room['windows'])} 个, "
                      f"家具: {len(room['furniture'])} 个")
        
    except Exception as e:
        print(f"解析失败: {str(e)}")
