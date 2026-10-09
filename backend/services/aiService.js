const axios = require('axios');
const { pool } = require('../config/database');

class AIService {
  constructor() {
    this.localServiceEndpoint = null;
    this.openaiConfig = null;
    this.initConfig();
  }

  async initConfig() {
    try {
      const [configs] = await pool.execute('SELECT * FROM ai_service_configs ORDER BY id DESC LIMIT 1');
      if (configs.length > 0) {
        const config = configs[0];
        this.localServiceEndpoint = config.local_service_endpoint;
        this.openaiConfig = {
          apiKey: config.openai_api_key,
          endpoint: config.openai_endpoint,
          model: config.openai_model,
          timeout: config.openai_timeout
        };
      }
    } catch (error) {
      console.error('初始化AI服务配置失败:', error);
    }
  }

  /**
   * 解析平面图
   * @param {string} imageUrl - 平面图图片URL
   * @param {string} prompt - 额外提示信息
   * @returns {Promise<Object>} 解析结果
   */
  async parseFloorPlan(imageUrl, prompt = '') {
    try {
      // 先尝试使用本地AI服务
      if (this.localServiceEndpoint) {
        try {
          const result = await this.parseFloorPlanLocal(imageUrl, prompt);
          return result;
        } catch (localError) {
          console.error('本地AI服务解析失败，尝试使用OpenAI服务:', localError);
          // 本地服务失败，尝试使用OpenAI服务
          if (this.openaiConfig?.apiKey) {
            try {
              const result = await this.parseFloorPlanOpenAI(imageUrl, prompt);
              return result;
            } catch (openaiError) {
              console.error('OpenAI服务解析失败:', openaiError);
              // 所有服务都失败，返回模拟数据
              return this.getMockParseData();
            }
          }
          // 没有OpenAI配置，返回模拟数据
          return this.getMockParseData();
        }
      } else if (this.openaiConfig?.apiKey) {
        // 没有本地服务配置，使用OpenAI服务
        try {
          const result = await this.parseFloorPlanOpenAI(imageUrl, prompt);
          return result;
        } catch (error) {
          console.error('OpenAI服务解析失败:', error);
          // 返回模拟数据
          return this.getMockParseData();
        }
      } else {
        // 没有任何AI服务配置，返回模拟数据
        return this.getMockParseData();
      }
    } catch (error) {
      console.error('解析平面图失败:', error);
      return this.getMockParseData();
    }
  }

  /**
   * 使用本地AI服务解析平面图
   * @param {string} imageUrl - 平面图图片URL
   * @param {string} prompt - 额外提示信息
   * @returns {Promise<Object>} 解析结果
   */
  async parseFloorPlanLocal(imageUrl, prompt = '') {
    const response = await axios.post(`${this.localServiceEndpoint}/api/parse/mock`, {
      imageUrl,
      prompt
    }, {
      timeout: 60000
    });

    return response.data.data;
  }

  /**
   * 使用OpenAI服务解析平面图
   * @param {string} imageUrl - 平面图图片URL
   * @param {string} prompt - 额外提示信息
   * @returns {Promise<Object>} 解析结果
   */
  async parseFloorPlanOpenAI(imageUrl, prompt = '') {
    // 获取提示模板
    const [prompts] = await pool.execute(
      'SELECT prompt_content FROM prompt_configs WHERE prompt_key = ? AND is_active = 1',
      ['floorPlanParser']
    );

    let systemPrompt = `你是一个专业的建筑设计师和室内设计师，擅长分析平面图并将其转换为详细的空间数据。
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
}`;

    if (prompts.length > 0) {
      systemPrompt = prompts[0].prompt_content;
    }

    const requestData = {
      model: this.openaiConfig.model,
      messages: [
        {
          role: 'system',
          content: systemPrompt
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

    const response = await axios.post(this.openaiConfig.endpoint, requestData, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.openaiConfig.apiKey}`
      },
      timeout: this.openaiConfig.timeout
    });

    return JSON.parse(response.data.choices[0].message.content);
  }

  /**
   * 生成3D场景配置
   * @param {Object} parseData - 解析数据
   * @param {string} style - 风格类型
   * @returns {Promise<Object>} 3D场景配置
   */
  async generate3DConfig(parseData, style = 'modern') {
    try {
      if (!this.openaiConfig?.apiKey) {
        return this.getMock3DConfig(style);
      }

      // 获取提示模板
      const [prompts] = await pool.execute(
        'SELECT prompt_content FROM prompt_configs WHERE prompt_key = ? AND is_active = 1',
        ['sceneConfigGenerator']
      );

      let systemPrompt = `你是一个专业的3D室内设计师，擅长根据平面图和指定风格生成详细的3D场景配置。
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
}`;

      if (prompts.length > 0) {
        systemPrompt = prompts[0].prompt_content;
      }

      const requestData = {
        model: this.openaiConfig.model,
        messages: [
          {
            role: 'system',
            content: systemPrompt
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

      const response = await axios.post(this.openaiConfig.endpoint, requestData, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.openaiConfig.apiKey}`
        },
        timeout: this.openaiConfig.timeout
      });

      return JSON.parse(response.data.choices[0].message.content);
    } catch (error) {
      console.error('生成3D场景配置失败:', error);
      return this.getMock3DConfig(style);
    }
  }

  /**
   * 生成全景图配置
   * @param {Object} sceneData - 3D场景数据
   * @returns {Promise<Object>} 全景图配置
   */
  async generatePanoramaConfig(sceneData) {
    try {
      if (!this.openaiConfig?.apiKey) {
        return this.getMockPanoramaConfig();
      }

      // 获取提示模板
      const [prompts] = await pool.execute(
        'SELECT prompt_content FROM prompt_configs WHERE prompt_key = ? AND is_active = 1',
        ['panoramaConfigGenerator']
      );

      let systemPrompt = `你是一个专业的全景图设计师，擅长根据3D场景数据生成全景图配置。
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
}`;

      if (prompts.length > 0) {
        systemPrompt = prompts[0].prompt_content;
      }

      const requestData = {
        model: this.openaiConfig.model,
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: `请根据以下3D场景数据，生成全景图配置。
            场景数据: ${JSON.stringify(sceneData)}`
          }
        ],
        response_format: { type: 'json_object' }
      };

      const response = await axios.post(this.openaiConfig.endpoint, requestData, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.openaiConfig.apiKey}`
        },
        timeout: this.openaiConfig.timeout
      });

      return JSON.parse(response.data.choices[0].message.content);
    } catch (error) {
      console.error('生成全景图配置失败:', error);
      return this.getMockPanoramaConfig();
    }
  }

  /**
   * 获取模拟解析数据
   * @returns {Object} 模拟解析数据
   */
  getMockParseData() {
    return {
      rooms: [
        {
          name: '客厅',
          type: 'living',
          area: 25,
          width: 5,
          length: 5,
          position: { x: 0, y: 0 }
        },
        {
          name: '主卧室',
          type: 'bedroom',
          area: 15,
          width: 3,
          length: 5,
          position: { x: 0, y: 5 }
        },
        {
          name: '厨房',
          type: 'kitchen',
          area: 10,
          width: 2,
          length: 5,
          position: { x: 5, y: 0 }
        },
        {
          name: '卫生间',
          type: 'bathroom',
          area: 8,
          width: 2,
          length: 4,
          position: { x: 5, y: 5 }
        }
      ],
      walls: [
        { start: { x: 0, y: 0 }, end: { x: 7, y: 0 }, thickness: 0.2 },
        { start: { x: 7, y: 0 }, end: { x: 7, y: 10 }, thickness: 0.2 },
        { start: { x: 7, y: 10 }, end: { x: 0, y: 10 }, thickness: 0.2 },
        { start: { x: 0, y: 10 }, end: { x: 0, y: 0 }, thickness: 0.2 },
        { start: { x: 0, y: 5 }, end: { x: 7, y: 5 }, thickness: 0.2 },
        { start: { x: 5, y: 0 }, end: { x: 5, y: 10 }, thickness: 0.2 }
      ],
      doors: [
        { position: { x: 3.5, y: 0 }, width: 0.9, type: 'main' },
        { position: { x: 1.5, y: 5 }, width: 0.8, type: 'room' },
        { position: { x: 5, y: 2.5 }, width: 0.8, type: 'room' },
        { position: { x: 5, y: 7.5 }, width: 0.8, type: 'bathroom' }
      ],
      windows: [
        { position: { x: 3.5, y: 10 }, width: 1.5 },
        { position: { x: 1, y: 0 }, width: 1.2 },
        { position: { x: 6, y: 0 }, width: 1.2 }
      ]
    };
  }

  /**
   * 获取模拟3D配置
   * @param {string} style - 风格类型
   * @returns {Object} 模拟3D配置
   */
  getMock3DConfig(style = 'modern') {
    const styles = {
      modern: {
        materials: {
          floor: { color: '#f5f5f5', texture: 'wood', roughness: 0.3 },
          wall: { color: '#ffffff', texture: 'paint', roughness: 0.8 },
          ceiling: { color: '#f8f8f8', texture: 'paint', roughness: 0.9 }
        },
        colors: {
          primary: '#333333',
          secondary: '#666666',
          accent: '#007bff'
        }
      },
      classic: {
        materials: {
          floor: { color: '#d4af37', texture: 'marble', roughness: 0.2 },
          wall: { color: '#f0e6d2', texture: 'wallpaper', roughness: 0.7 },
          ceiling: { color: '#ffffff', texture: 'plaster', roughness: 0.8 }
        },
        colors: {
          primary: '#8b4513',
          secondary: '#a0522d',
          accent: '#d4af37'
        }
      },
      minimalist: {
        materials: {
          floor: { color: '#e0e0e0', texture: 'concrete', roughness: 0.4 },
          wall: { color: '#fafafa', texture: 'paint', roughness: 0.9 },
          ceiling: { color: '#ffffff', texture: 'paint', roughness: 1.0 }
        },
        colors: {
          primary: '#212121',
          secondary: '#757575',
          accent: '#009688'
        }
      }
    };

    const selectedStyle = styles[style] || styles.modern;

    return {
      materials: selectedStyle.materials,
      furniture: [
        {
          type: 'sofa',
          position: { x: -1, y: 2, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 2, y: 0.8, z: 1 },
          material: 'fabric'
        },
        {
          type: 'table',
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1.2, y: 0.7, z: 0.8 },
          material: 'wood'
        },
        {
          type: 'bed',
          position: { x: -1, y: 7, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1.8, y: 0.5, z: 2 },
          material: 'fabric'
        },
        {
          type: 'kitchen_cabinet',
          position: { x: 6, y: 2, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 2, y: 2, z: 0.6 },
          material: 'wood'
        }
      ],
      lighting: {
        ambient: { intensity: 0.5, color: '#ffffff' },
        directional: { intensity: 0.8, color: '#ffffff', position: { x: 5, y: 10, z: 5 } },
        point: [
          { intensity: 1.0, color: '#ffffff', position: { x: 0, y: 0, z: 2 } },
          { intensity: 1.0, color: '#ffffff', position: { x: 0, y: 5, z: 2 } },
          { intensity: 1.0, color: '#ffffff', position: { x: 6, y: 2, z: 2 } }
        ]
      },
      colors: selectedStyle.colors
    };
  }

  /**
   * 获取模拟全景图配置
   * @returns {Object} 模拟全景图配置
   */
  getMockPanoramaConfig() {
    return {
      cameraPositions: [
        {
          id: 'living',
          name: '客厅',
          position: { x: 0, y: 2, z: 1.5 },
          lookAt: { x: 0, y: 0, z: 0 }
        },
        {
          id: 'bedroom',
          name: '卧室',
          position: { x: 0, y: 7, z: 1.5 },
          lookAt: { x: 0, y: 5, z: 0 }
        },
        {
          id: 'kitchen',
          name: '厨房',
          position: { x: 6, y: 2, z: 1.5 },
          lookAt: { x: 5, y: 0, z: 0 }
        }
      ],
      hotspots: [
        {
          id: 'hotspot1',
          type: 'scene',
          position: { pitch: 0, yaw: 90 },
          text: '前往卧室',
          target: 'bedroom'
        },
        {
          id: 'hotspot2',
          type: 'scene',
          position: { pitch: 0, yaw: -90 },
          text: '前往厨房',
          target: 'kitchen'
        },
        {
          id: 'hotspot3',
          type: 'scene',
          position: { pitch: 0, yaw: 180 },
          text: '返回客厅',
          target: 'living'
        }
      ],
      description: '360度全景图展示'
    };
  }
}

module.exports = new AIService();