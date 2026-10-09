import axios from 'axios';
import { configService } from './configService.js';

/**
 * AI服务 - 用于与ChatGPT和本地AI服务交互
 */
export const aiService = {
  /**
   * 获取AI服务配置
   * @returns {Object} AI服务配置
   */
  getConfig() {
    return configService.getAiServiceConfig();
  },
  /**
   * 解析平面图
   * @param {string} imageUrl - 平面图图片URL
   * @param {string} prompt - 额外提示信息
   * @returns {Promise<Object>} 解析结果
   */
  async parseFloorPlan(imageUrl, prompt = '') {
    try {
      console.log('开始解析平面图...');
      const config = this.getConfig();
      
      // 根据配置选择解析服务
      if (config.parseService === 'local') {
        // 使用本地AI服务
        return await this.parseFloorPlanLocal(imageUrl, prompt);
      } else {
        // 使用OpenAI服务
        return await this.parseFloorPlanOpenAI(imageUrl, prompt);
      }
    } catch (error) {
      console.error('解析平面图失败:', error);
      // 返回模拟数据作为 fallback
      return this.getMockParseData();
    }
  },
  
  /**
   * 使用本地AI服务解析平面图
   * @param {string} imageUrl - 平面图图片URL
   * @param {string} prompt - 额外提示信息
   * @returns {Promise<Object>} 解析结果
   */
  async parseFloorPlanLocal(imageUrl, prompt = '') {
    try {
      console.log('使用本地AI服务解析平面图...');
      const config = this.getConfig();
      
      // 构建请求数据
      const formData = new FormData();
      
      // 这里需要将图片URL转换为File对象
      // 实际项目中，应该直接上传文件
      // 这里使用模拟数据
      
      // 调用本地AI服务
      const response = await axios.post(`${config.localService.endpoint}/api/parse/mock`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        },
        timeout: config.localService.timeout
      });
      
      console.log('本地AI服务解析完成:', response.data);
      return response.data.data;
    } catch (error) {
      console.error('本地AI服务解析失败:', error);
      //  fallback到OpenAI服务
      return this.parseFloorPlanOpenAI(imageUrl, prompt);
    }
  },
  
  /**
   * 使用OpenAI服务解析平面图
   * @param {string} imageUrl - 平面图图片URL
   * @param {string} prompt - 额外提示信息
   * @returns {Promise<Object>} 解析结果
   */
  async parseFloorPlanOpenAI(imageUrl, prompt = '') {
    try {
      console.log('使用OpenAI服务解析平面图...');
      const config = this.getConfig();
      const prompts = configService.getPromptsConfig();
      
      // 构建请求数据
      const requestData = {
        model: config.openai.model,
        messages: [
          {
            role: 'system',
            content: prompts.floorPlanParser
          },
          {
            role: 'user',
            content: `请分析以下平面图，识别所有房间、墙体、门窗等元素，并按照指定格式输出结构化数据。
            平面图URL: ${imageUrl}
            额外信息: ${prompt}`
          }
        ],
        response_format: { type: 'json_object' }
      };

      // 调用ChatGPT API
      const response = await axios.post(config.openai.endpoint, requestData, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.openai.apiKey}`
        },
        timeout: config.openai.timeout
      });

      const parseData = response.data.choices[0].message.content;
      console.log('OpenAI服务解析完成:', parseData);
      
      return JSON.parse(parseData);
    } catch (error) {
      console.error('OpenAI服务解析失败:', error);
      throw error;
    }
  },

  /**
   * 生成3D场景配置
   * @param {Object} parseData - 解析数据
   * @param {string} style - 风格类型
   * @returns {Promise<Object>} 3D场景配置
   */
  async generate3DConfig(parseData, style = 'modern') {
    try {
      console.log('开始生成3D场景配置...');
      const config = this.getConfig();
      const prompts = configService.getPromptsConfig();
      
      const requestData = {
        model: config.openai.model,
        messages: [
          {
            role: 'system',
            content: prompts.sceneConfigGenerator
          },
          {
            role: 'user',
            content: `请根据以下平面图解析数据，生成${style}风格的3D场景配置。
            解析数据: ${JSON.stringify(parseData)}
            风格: ${style}`
          }
        ],
        response_format: { type: 'json_object' }
      };

      const response = await axios.post(config.openai.endpoint, requestData, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.openai.apiKey}`
        },
        timeout: config.openai.timeout
      });

      const configData = response.data.choices[0].message.content;
      console.log('3D场景配置生成完成:', configData);
      
      return JSON.parse(configData);
    } catch (error) {
      console.error('生成3D场景配置失败:', error);
      // 返回默认配置作为 fallback
      return this.getMock3DConfig(style);
    }
  },

  /**
   * 生成全景图配置
   * @param {Object} sceneData - 3D场景数据
   * @returns {Promise<Object>} 全景图配置
   */
  async generatePanoramaConfig(sceneData) {
    try {
      console.log('开始生成全景图配置...');
      const config = this.getConfig();
      const prompts = configService.getPromptsConfig();
      
      const requestData = {
        model: config.openai.model,
        messages: [
          {
            role: 'system',
            content: prompts.panoramaConfigGenerator
          },
          {
            role: 'user',
            content: `请根据以下3D场景数据，生成全景图配置。
            场景数据: ${JSON.stringify(sceneData)}`
          }
        ],
        response_format: { type: 'json_object' }
      };

      const response = await axios.post(config.openai.endpoint, requestData, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.openai.apiKey}`
        },
        timeout: config.openai.timeout
      });

      const configData = response.data.choices[0].message.content;
      console.log('全景图配置生成完成:', configData);
      
      return JSON.parse(configData);
    } catch (error) {
      console.error('生成全景图配置失败:', error);
      // 返回默认配置作为 fallback
      return this.getMockPanoramaConfig();
    }
  },

  /**
   * 获取模拟解析数据
   * @returns {Object} 模拟解析数据
   */
  getMockParseData() {
    return {
      rooms: [
        { name: '客厅', type: 'living', area: 35, width: 7, length: 5, position: { x: 0, y: 0 } },
        { name: '主卧', type: 'bedroom', area: 18, width: 4.5, length: 4, position: { x: 7, y: 0 } },
        { name: '次卧', type: 'bedroom', area: 12, width: 3, length: 4, position: { x: 7, y: 4 } },
        { name: '厨房', type: 'kitchen', area: 8, width: 2.5, length: 3.2, position: { x: 0, y: 5 } },
        { name: '卫生间', type: 'bathroom', area: 6, width: 2, length: 3, position: { x: 2.5, y: 5 } }
      ],
      walls: [
        { start: { x: 0, y: 0 }, end: { x: 11, y: 0 }, thickness: 0.2 },
        { start: { x: 11, y: 0 }, end: { x: 11, y: 8 }, thickness: 0.2 },
        { start: { x: 11, y: 8 }, end: { x: 0, y: 8 }, thickness: 0.2 },
        { start: { x: 0, y: 8 }, end: { x: 0, y: 0 }, thickness: 0.2 },
        { start: { x: 7, y: 0 }, end: { x: 7, y: 8 }, thickness: 0.2 },
        { start: { x: 0, y: 5 }, end: { x: 7, y: 5 }, thickness: 0.2 },
        { start: { x: 2.5, y: 5 }, end: { x: 2.5, y: 8 }, thickness: 0.2 }
      ],
      doors: [
        { position: { x: 3.5, y: 0 }, width: 0.9, type: 'main' },
        { position: { x: 7, y: 2 }, width: 0.8, type: 'room' },
        { position: { x: 7, y: 6 }, width: 0.8, type: 'room' },
        { position: { x: 1.25, y: 5 }, width: 0.8, type: 'kitchen' },
        { position: { x: 3.75, y: 5 }, width: 0.8, type: 'bathroom' }
      ],
      windows: [
        { position: { x: 11, y: 1.5 }, width: 1.5 },
        { position: { x: 11, y: 6.5 }, width: 1.5 },
        { position: { x: 0, y: 1.5 }, width: 1.5 }
      ]
    };
  },

  /**
   * 获取模拟3D配置
   * @param {string} style - 风格类型
   * @returns {Object} 模拟3D配置
   */
  getMock3DConfig(style = 'modern') {
    const configs = {
      modern: {
        materials: {
          floor: { color: '#D2B48C', texture: 'wood', roughness: 0.7 },
          wall: { color: '#F5F5F5', texture: 'paint', roughness: 0.9 },
          ceiling: { color: '#FFFFFF', texture: 'paint', roughness: 0.9 }
        },
        furniture: [
          { type: 'sofa', position: { x: 2, y: 0.5, z: 1.5 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, material: 'fabric' },
          { type: 'coffeeTable', position: { x: 3, y: 0, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, material: 'wood' },
          { type: 'tv', position: { x: 5, y: 1, z: 0.5 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, material: 'metal' },
          { type: 'bed', position: { x: 9, y: 0.5, z: 2 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, material: 'fabric' },
          { type: 'wardrobe', position: { x: 7.5, y: 1.5, z: 3.5 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, material: 'wood' },
          { type: 'kitchenCabinet', position: { x: 0.5, y: 1, z: 6 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, material: 'wood' },
          { type: 'sink', position: { x: 1.25, y: 0.8, z: 6 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, material: 'ceramic' }
        ],
        lighting: {
          ambient: { intensity: 0.4, color: '#FFFFFF' },
          directional: { intensity: 1.0, color: '#FFFFFF', position: { x: 10, y: 30, z: 15 } },
          point: [
            { intensity: 0.6, color: '#FFFFFF', position: { x: 3, y: 3, z: 2 } },
            { intensity: 0.6, color: '#FFFFFF', position: { x: 9, y: 3, z: 2 } },
            { intensity: 0.6, color: '#FFFFFF', position: { x: 1.25, y: 3, z: 6.5 } }
          ]
        },
        colors: {
          primary: '#3498db',
          secondary: '#2ecc71',
          accent: '#e74c3c'
        }
      },
      classic: {
        materials: {
          floor: { color: '#8B4513', texture: 'wood', roughness: 0.6 },
          wall: { color: '#E8D5B9', texture: 'paint', roughness: 0.8 },
          ceiling: { color: '#F0E6D2', texture: 'paint', roughness: 0.8 }
        },
        furniture: [
          { type: 'sofa', position: { x: 2, y: 0.5, z: 1.5 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, material: 'leather' },
          { type: 'coffeeTable', position: { x: 3, y: 0, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, material: 'wood' },
          { type: 'tv', position: { x: 5, y: 1, z: 0.5 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, material: 'metal' },
          { type: 'bed', position: { x: 9, y: 0.5, z: 2 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, material: 'fabric' },
          { type: 'wardrobe', position: { x: 7.5, y: 1.5, z: 3.5 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, material: 'wood' },
          { type: 'kitchenCabinet', position: { x: 0.5, y: 1, z: 6 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, material: 'wood' },
          { type: 'sink', position: { x: 1.25, y: 0.8, z: 6 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, material: 'ceramic' }
        ],
        lighting: {
          ambient: { intensity: 0.5, color: '#F0E6D2' },
          directional: { intensity: 0.8, color: '#F0E6D2', position: { x: 10, y: 30, z: 15 } },
          point: [
            { intensity: 0.5, color: '#F0E6D2', position: { x: 3, y: 3, z: 2 } },
            { intensity: 0.5, color: '#F0E6D2', position: { x: 9, y: 3, z: 2 } },
            { intensity: 0.5, color: '#F0E6D2', position: { x: 1.25, y: 3, z: 6.5 } }
          ]
        },
        colors: {
          primary: '#8B4513',
          secondary: '#DAA520',
          accent: '#A0522D'
        }
      },
      minimalist: {
        materials: {
          floor: { color: '#FFFFFF', texture: 'tile', roughness: 0.5 },
          wall: { color: '#F8F9FA', texture: 'paint', roughness: 0.9 },
          ceiling: { color: '#FFFFFF', texture: 'paint', roughness: 0.9 }
        },
        furniture: [
          { type: 'sofa', position: { x: 2, y: 0.5, z: 1.5 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, material: 'fabric' },
          { type: 'coffeeTable', position: { x: 3, y: 0, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, material: 'wood' },
          { type: 'tv', position: { x: 5, y: 1, z: 0.5 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, material: 'metal' },
          { type: 'bed', position: { x: 9, y: 0.5, z: 2 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, material: 'fabric' },
          { type: 'wardrobe', position: { x: 7.5, y: 1.5, z: 3.5 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, material: 'wood' },
          { type: 'kitchenCabinet', position: { x: 0.5, y: 1, z: 6 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, material: 'wood' },
          { type: 'sink', position: { x: 1.25, y: 0.8, z: 6 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, material: 'ceramic' }
        ],
        lighting: {
          ambient: { intensity: 0.6, color: '#FFFFFF' },
          directional: { intensity: 1.2, color: '#FFFFFF', position: { x: 10, y: 30, z: 15 } },
          point: [
            { intensity: 0.4, color: '#FFFFFF', position: { x: 3, y: 3, z: 2 } },
            { intensity: 0.4, color: '#FFFFFF', position: { x: 9, y: 3, z: 2 } },
            { intensity: 0.4, color: '#FFFFFF', position: { x: 1.25, y: 3, z: 6.5 } }
          ]
        },
        colors: {
          primary: '#333333',
          secondary: '#666666',
          accent: '#007BFF'
        }
      }
    };

    return configs[style] || configs.modern;
  },

  /**
   * 获取模拟全景图配置
   * @returns {Object} 模拟全景图配置
   */
  getMockPanoramaConfig() {
    return {
      cameraPositions: [
        { id: 'living', name: '客厅', position: { x: 3, y: 1.6, z: 2.5 }, lookAt: { x: 5, y: 1.6, z: 2.5 } },
        { id: 'bedroom1', name: '主卧', position: { x: 9, y: 1.6, z: 2 }, lookAt: { x: 7, y: 1.6, z: 2 } },
        { id: 'bedroom2', name: '次卧', position: { x: 9, y: 1.6, z: 6 }, lookAt: { x: 7, y: 1.6, z: 6 } },
        { id: 'kitchen', name: '厨房', position: { x: 1.25, y: 1.6, z: 6.5 }, lookAt: { x: 2.5, y: 1.6, z: 6.5 } },
        { id: 'bathroom', name: '卫生间', position: { x: 3.75, y: 1.6, z: 6.5 }, lookAt: { x: 2.5, y: 1.6, z: 6.5 } }
      ],
      hotspots: [
        { id: 'hs1', type: 'scene', position: { pitch: 0, yaw: 90 }, text: '主卧', target: 'bedroom1' },
        { id: 'hs2', type: 'scene', position: { pitch: 0, yaw: 270 }, text: '厨房', target: 'kitchen' },
        { id: 'hs3', type: 'scene', position: { pitch: 0, yaw: 0 }, text: '客厅', target: 'living' },
        { id: 'hs4', type: 'scene', position: { pitch: 0, yaw: 180 }, text: '次卧', target: 'bedroom2' },
        { id: 'hs5', type: 'scene', position: { pitch: 0, yaw: 90 }, text: '卫生间', target: 'bathroom' }
      ],
      description: '现代风格家居全景图，包含客厅、主卧、次卧、厨房和卫生间'
    };
  }
};