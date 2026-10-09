/**
 * AI服务配置
 */
export const aiConfig = {
  // OpenAI API配置
  openai: {
    apiKey: import.meta.env.VITE_OPENAI_API_KEY,
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4-turbo',
    timeout: 30000 // 30秒超时
  },
  
  // 本地AI服务配置
  localService: {
    endpoint: 'http://localhost:8000',
    timeout: 60000 // 60秒超时
  },
  
  // 解析服务选择：'openai' 或 'local'
  parseService: 'local', // 优先使用本地服务
  
  // 3D风格配置
  styles: {
    modern: {
      name: '现代风格',
      description: '简约、时尚的现代设计风格'
    },
    classic: {
      name: '经典风格',
      description: '传统、典雅的经典设计风格'
    },
    minimalist: {
      name: '极简风格',
      description: '简洁、纯净的极简设计风格'
    }
  },
  
  // 提示模板
  prompts: {
    floorPlanParser: `你是一个专业的建筑设计师和室内设计师，擅长分析平面图并将其转换为详细的空间数据。
请分析提供的平面图，识别房间、墙体、门窗等元素，并输出结构化的JSON数据。
输出格式必须严格按照以下结构：
{
  "rooms": [
    {
      "name": "房间名称",
      "type": "房间类型（如living、bedroom、kitchen、bathroom等）",
      "area": 面积（平方米）,
      "width": 宽度（米）,
      "length": 长度（米）,
      "position": {"x": x坐标, "y": y坐标}
    }
  ],
  "walls": [
    {
      "start": {"x": x1, "y": y1},
      "end": {"x": x2, "y": y2},
      "thickness": 墙体厚度（米）
    }
  ],
  "doors": [
    {
      "position": {"x": x, "y": y},
      "width": 宽度（米）,
      "type": "门类型（如main、room、bathroom等）"
    }
  ],
  "windows": [
    {
      "position": {"x": x, "y": y},
      "width": 宽度（米）
    }
  ]
}`,
    
    sceneConfigGenerator: `你是一个专业的3D室内设计师，擅长根据平面图和指定风格生成详细的3D场景配置。
请根据提供的平面图解析数据和风格要求，生成3D场景的详细配置，包括：
1. 材质选择
2. 家具布局
3. 灯光设置
4. 色彩方案

输出格式必须严格按照以下结构：
{
  "materials": {
    "floor": {"color": "颜色值", "texture": "纹理类型", "roughness": 粗糙度值},
    "wall": {"color": "颜色值", "texture": "纹理类型", "roughness": 粗糙度值},
    "ceiling": {"color": "颜色值", "texture": "纹理类型", "roughness": 粗糙度值}
  },
  "furniture": [
    {
      "type": "家具类型",
      "position": {"x": x, "y": y, "z": z},
      "rotation": {"x": x, "y": y, "z": z},
      "scale": {"x": x, "y": y, "z": z},
      "material": "材质类型"
    }
  ],
  "lighting": {
    "ambient": {"intensity": 强度值, "color": "颜色值"},
    "directional": {"intensity": 强度值, "color": "颜色值", "position": {"x": x, "y": y, "z": z}},
    "point": [
      {"intensity": 强度值, "color": "颜色值", "position": {"x": x, "y": y, "z": z}}
    ]
  },
  "colors": {
    "primary": "主色调",
    "secondary": "辅助色",
    "accent": "强调色"
  }
}`,
    
    panoramaConfigGenerator: `你是一个专业的全景图设计师，擅长根据3D场景数据生成全景图配置。
请根据提供的3D场景数据，生成全景图的详细配置，包括：
1. 相机位置和角度
2. 热点标记（如房间切换点）
3. 场景描述

输出格式必须严格按照以下结构：
{
  "cameraPositions": [
    {
      "id": "位置ID",
      "name": "位置名称",
      "position": {"x": x, "y": y, "z": z},
      "lookAt": {"x": x, "y": y, "z": z}
    }
  ],
  "hotspots": [
    {
      "id": "热点ID",
      "type": "热点类型",
      "position": {"pitch": 俯仰角, "yaw": 偏航角},
      "text": "热点文本",
      "target": "目标位置ID"
    }
  ],
  "description": "场景描述"
}`
  },
  
  // 错误处理配置
  errorHandling: {
    maxRetries: 3,
    retryDelay: 1000 // 1秒延迟
  }
};