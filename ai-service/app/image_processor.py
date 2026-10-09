"""
图像预处理模块
用于平面图的预处理，包括去噪、增强、矫正等操作
"""

import cv2
import numpy as np
from PIL import Image
from pathlib import Path
from typing import Union, Tuple, Optional
from loguru import logger


class ImageProcessor:
    """图像处理器"""
    
    def __init__(self):
        self.ready = True
        logger.info("图像处理器初始化完成")
    
    def is_ready(self) -> bool:
        """检查处理器是否就绪"""
        return self.ready
    
    def process(self, image_path: Union[str, Path]) -> np.ndarray:
        """
        处理图像
        
        Args:
            image_path: 图像文件路径
            
        Returns:
            处理后的图像数组
        """
        try:
            # 读取图像
            image = self._load_image(image_path)
            
            # 去噪
            image = self._denoise(image)
            
            # 增强对比度
            image = self._enhance_contrast(image)
            
            # 矫正倾斜
            image = self._correct_skew(image)
            
            # 调整大小
            image = self._resize(image)
            
            logger.info("图像预处理完成")
            return image
            
        except Exception as e:
            logger.error(f"图像预处理失败: {str(e)}")
            raise
    
    def _load_image(self, image_path: Union[str, Path]) -> np.ndarray:
        """
        加载图像
        
        Args:
            image_path: 图像文件路径
            
        Returns:
            图像数组
        """
        image_path = Path(image_path)
        
        if not image_path.exists():
            raise FileNotFoundError(f"图像文件不存在: {image_path}")
        
        # 使用PIL加载图像（支持更多格式）
        try:
            pil_image = Image.open(image_path)
            # 转换为RGB模式
            if pil_image.mode != 'RGB':
                pil_image = pil_image.convert('RGB')
            # 转换为OpenCV格式
            image = cv2.cvtColor(np.array(pil_image), cv2.COLOR_RGB2BGR)
        except Exception as e:
            # 如果PIL加载失败，尝试使用OpenCV
            image = cv2.imread(str(image_path))
            if image is None:
                raise ValueError(f"无法加载图像: {image_path}")
        
        logger.info(f"图像加载成功: {image.shape}")
        return image
    
    def _denoise(self, image: np.ndarray) -> np.ndarray:
        """
        图像去噪
        
        Args:
            image: 输入图像
            
        Returns:
            去噪后的图像
        """
        # 使用非局部均值去噪
        denoised = cv2.fastNlMeansDenoisingColored(image, None, 10, 10, 7, 21)
        logger.debug("图像去噪完成")
        return denoised
    
    def _enhance_contrast(self, image: np.ndarray) -> np.ndarray:
        """
        增强对比度
        
        Args:
            image: 输入图像
            
        Returns:
            增强后的图像
        """
        # 转换为LAB颜色空间
        lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        
        # 应用CLAHE（对比度受限的自适应直方图均衡化）
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        l = clahe.apply(l)
        
        # 合并通道
        enhanced = cv2.merge([l, a, b])
        enhanced = cv2.cvtColor(enhanced, cv2.COLOR_LAB2BGR)
        
        logger.debug("对比度增强完成")
        return enhanced
    
    def _correct_skew(self, image: np.ndarray) -> np.ndarray:
        """
        矫正图像倾斜
        
        Args:
            image: 输入图像
            
        Returns:
            矫正后的图像
        """
        # 转换为灰度图
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        
        # 二值化
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        
        # 检测轮廓
        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        if not contours:
            logger.debug("未检测到轮廓，跳过倾斜矫正")
            return image
        
        # 找到最大的轮廓
        largest_contour = max(contours, key=cv2.contourArea)
        
        # 计算最小外接矩形
        rect = cv2.minAreaRect(largest_contour)
        angle = rect[2]
        
        # 如果角度很小，不需要矫正
        if abs(angle) < 1:
            logger.debug("倾斜角度很小，跳过矫正")
            return image
        
        # 调整角度
        if angle < -45:
            angle = 90 + angle
        
        # 获取旋转矩阵
        (h, w) = image.shape[:2]
        center = (w // 2, h // 2)
        M = cv2.getRotationMatrix2D(center, angle, 1.0)
        
        # 计算新图像大小
        cos = np.abs(M[0, 0])
        sin = np.abs(M[0, 1])
        new_w = int((h * sin) + (w * cos))
        new_h = int((h * cos) + (w * sin))
        
        # 调整旋转矩阵
        M[0, 2] += (new_w / 2) - center[0]
        M[1, 2] += (new_h / 2) - center[1]
        
        # 旋转图像
        rotated = cv2.warpAffine(image, M, (new_w, new_h), borderMode=cv2.BORDER_CONSTANT, borderValue=(255, 255, 255))
        
        logger.debug(f"倾斜矫正完成，角度: {angle:.2f}度")
        return rotated
    
    def _resize(self, image: np.ndarray, max_size: int = 2048) -> np.ndarray:
        """
        调整图像大小
        
        Args:
            image: 输入图像
            max_size: 最大边长
            
        Returns:
            调整后的图像
        """
        h, w = image.shape[:2]
        
        # 如果图像已经小于最大尺寸，不需要调整
        if max(h, w) <= max_size:
            return image
        
        # 计算缩放比例
        scale = max_size / max(h, w)
        new_w = int(w * scale)
        new_h = int(h * scale)
        
        # 调整大小
        resized = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_AREA)
        
        logger.debug(f"图像调整大小: {w}x{h} -> {new_w}x{new_h}")
        return resized
    
    def preprocess_for_ocr(self, image: np.ndarray) -> np.ndarray:
        """
        为OCR预处理图像
        
        Args:
            image: 输入图像
            
        Returns:
            预处理后的图像
        """
        # 转换为灰度图
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        
        # 二值化
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        
        # 去噪
        denoised = cv2.fastNlMeansDenoising(binary, None, 10, 7, 21)
        
        return denoised
    
    def preprocess_for_detection(self, image: np.ndarray) -> np.ndarray:
        """
        为目标检测预处理图像
        
        Args:
            image: 输入图像
            
        Returns:
            预处理后的图像
        """
        # 增强对比度
        lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
        l = clahe.apply(l)
        
        enhanced = cv2.merge([l, a, b])
        enhanced = cv2.cvtColor(enhanced, cv2.COLOR_LAB2BGR)
        
        return enhanced
    
    def save_debug_image(self, image: np.ndarray, filename: str):
        """
        保存调试图像
        
        Args:
            image: 图像数组
            filename: 文件名
        """
        debug_dir = Path("debug")
        debug_dir.mkdir(exist_ok=True)
        
        output_path = debug_dir / filename
        cv2.imwrite(str(output_path), image)
        logger.debug(f"调试图像已保存: {output_path}")


# 测试代码
if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("用法: python image_processor.py <图像路径>")
        sys.exit(1)
    
    image_path = sys.argv[1]
    processor = ImageProcessor()
    
    try:
        processed_image = processor.process(image_path)
        processor.save_debug_image(processed_image, "processed.jpg")
        print(f"图像处理完成，输出尺寸: {processed_image.shape}")
    except Exception as e:
        print(f"处理失败: {str(e)}")
