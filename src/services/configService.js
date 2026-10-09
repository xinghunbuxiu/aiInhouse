import axios from 'axios'
import { API_BASE_URL, getLoginRoute } from './apiClient'

// 创建axios实例
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json'
  }
})

// 请求拦截器 - 添加认证令牌
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// 响应拦截器 - 处理错误
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // 令牌过期，清除本地存储并跳转到登录页
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      window.location.href = getLoginRoute()
    }
    return Promise.reject(error)
  }
)

/**
 * 配置服务 - 用于管理系统配置
 */
export const configService = {
  /**
   * 获取AI服务配置
   * @returns {Promise<Object>} AI服务配置
   */
  async getAiServiceConfig() {
    try {
      const response = await apiClient.get('/config/ai-service')
      if (response.data.success) {
        return response.data.data
      }
      throw new Error(response.data.message)
    } catch (error) {
      console.error('获取AI服务配置失败:', error)
      // 返回默认配置
      return {
        parseService: 'local',
        openai: {
          apiKey: import.meta.env.VITE_OPENAI_API_KEY || '',
          endpoint: 'https://api.openai.com/v1/chat/completions',
          model: 'gpt-4-turbo',
          timeout: 30000
        },
        localService: {
          endpoint: 'http://localhost:8000',
          timeout: 60000
        }
      }
    }
  },

  /**
   * 保存AI服务配置
   * @param {Object} config - AI服务配置
   * @returns {Promise<Object>}
   */
  async saveAiServiceConfig(config) {
    try {
      const response = await apiClient.put('/config/ai-service', config)
      return response.data
    } catch (error) {
      console.error('保存AI服务配置失败:', error)
      throw error
    }
  },

  /**
   * 获取风格配置
   * @returns {Promise<Object>} 风格配置
   */
  async getStylesConfig() {
    try {
      const response = await apiClient.get('/config/styles')
      if (response.data.success) {
        return response.data.data
      }
      throw new Error(response.data.message)
    } catch (error) {
      console.error('获取风格配置失败:', error)
      // 返回默认配置
      return {
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
      }
    }
  },

  /**
   * 获取所有风格配置（管理员）
   * @returns {Promise<Array>}
   */
  async getAllStylesConfig() {
    try {
      const response = await apiClient.get('/config/styles/all')
      return response.data
    } catch (error) {
      console.error('获取所有风格配置失败:', error)
      throw error
    }
  },

  /**
   * 创建风格配置
   * @param {Object} style - 风格配置
   * @returns {Promise<Object>}
   */
  async createStyleConfig(style) {
    try {
      const response = await apiClient.post('/config/styles', style)
      return response.data
    } catch (error) {
      console.error('创建风格配置失败:', error)
      throw error
    }
  },

  /**
   * 更新风格配置
   * @param {number} id - 风格ID
   * @param {Object} style - 风格配置
   * @returns {Promise<Object>}
   */
  async updateStyleConfig(id, style) {
    try {
      const response = await apiClient.put(`/config/styles/${id}`, style)
      return response.data
    } catch (error) {
      console.error('更新风格配置失败:', error)
      throw error
    }
  },

  /**
   * 删除风格配置
   * @param {number} id - 风格ID
   * @returns {Promise<Object>}
   */
  async deleteStyleConfig(id) {
    try {
      const response = await apiClient.delete(`/config/styles/${id}`)
      return response.data
    } catch (error) {
      console.error('删除风格配置失败:', error)
      throw error
    }
  },

  /**
   * 获取提示模板配置
   * @returns {Promise<Object>} 提示模板配置
   */
  async getPromptsConfig() {
    try {
      const response = await apiClient.get('/config/prompts')
      if (response.data.success) {
        return response.data.data
      }
      throw new Error(response.data.message)
    } catch (error) {
      console.error('获取提示模板配置失败:', error)
      // 返回默认配置
      return {
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
      }
    }
  },

  /**
   * 获取所有提示模板配置（管理员）
   * @returns {Promise<Array>}
   */
  async getAllPromptsConfig() {
    try {
      const response = await apiClient.get('/config/prompts/all');
      return response.data;
    } catch (error) {
      console.error('获取所有提示模板配置失败:', error);
      throw error;
    }
  },

  /**
   * 更新提示模板配置
   * @param {string} promptKey - 提示模板标识
   * @param {string} promptContent - 提示模板内容
   * @returns {Promise<Object>}
   */
  async updatePromptConfig(promptKey, promptContent) {
    try {
      const response = await apiClient.put(`/config/prompts/${promptKey}`, {
        promptContent
      });
      return response.data;
    } catch (error) {
      console.error('更新提示模板配置失败:', error);
      throw error;
    }
  },

  /**
   * 获取系统配置
   * @returns {Promise<Object>}
   */
  async getSystemConfig() {
    try {
      const response = await apiClient.get('/config/system');
      return response.data;
    } catch (error) {
      console.error('获取系统配置失败:', error);
      throw error;
    }
  },

  /**
   * 更新系统配置
   * @param {string} configKey - 配置键
   * @param {*} configValue - 配置值
   * @returns {Promise<Object>}
   */
  async updateSystemConfig(configKey, configValue) {
    try {
      const response = await apiClient.put(`/config/system/${configKey}`, {
        configValue
      });
      return response.data;
    } catch (error) {
      console.error('更新系统配置失败:', error);
      throw error;
    }
  },

  /**
   * 保存所有配置（向后端批量保存）
   * @param {Object} config - 完整配置对象
   * @returns {Promise<Object>}
   */
  async saveAllConfig(config) {
    try {
      // 保存AI服务配置
      if (config.aiService) {
        await this.saveAiServiceConfig(config.aiService);
      }

      // 保存系统配置
      if (config.systemName) {
        await this.updateSystemConfig('system_name', config.systemName);
      }
      if (config.description) {
        await this.updateSystemConfig('system_description', config.description);
      }

      return {
        success: true,
        message: '配置保存成功'
      };
    } catch (error) {
      console.error('保存配置失败:', error);
      throw error;
    }
  }
};

export default configService;
