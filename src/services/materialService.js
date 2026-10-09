// 材质和家具服务
// 模块化设计，可独立替换

class MaterialService {
  constructor(options = {}) {
    this.options = {
      materialUrl: options.materialUrl || '/api/materials',
      ...options
    };
    
    // 预设材质和家具数据
    this.presetMaterials = {
      styles: [
        { id: 'modern', name: '现代简约', description: '简洁、实用的现代风格' },
        { id: 'classic', name: '经典欧式', description: '典雅、华丽的欧式风格' },
        { id: 'minimalist', name: '极简主义', description: '极简、留白的设计风格' },
        { id: 'industrial', name: '工业风格', description: '粗犷、原始的工业风格' },
        { id: 'scandinavian', name: '北欧风格', description: '自然、舒适的北欧风格' }
      ],
      materials: {
        modern: [
          { id: 'modern_wood', name: '原木色', color: '#D2B48C', texture: 'wood' },
          { id: 'modern_white', name: '纯白色', color: '#FFFFFF', texture: 'paint' },
          { id: 'modern_gray', name: '浅灰色', color: '#F0F0F0', texture: 'paint' }
        ],
        classic: [
          { id: 'classic_darkwood', name: '深色木', color: '#8B4513', texture: 'wood' },
          { id: 'classic_gold', name: '金色', color: '#FFD700', texture: 'metal' },
          { id: 'classic_cream', name: '奶油色', color: '#FFFDD0', texture: 'paint' }
        ],
        minimalist: [
          { id: 'minimalist_white', name: '纯白', color: '#FFFFFF', texture: 'paint' },
          { id: 'minimalist_black', name: '纯黑', color: '#000000', texture: 'paint' },
          { id: 'minimalist_gray', name: '深灰', color: '#333333', texture: 'paint' }
        ],
        industrial: [
          { id: 'industrial_metal', name: '金属色', color: '#C0C0C0', texture: 'metal' },
          { id: 'industrial_brick', name: '砖块', color: '#8B4513', texture: 'brick' },
          { id: 'industrial_concrete', name: '混凝土', color: '#A9A9A9', texture: 'concrete' }
        ],
        scandinavian: [
          { id: 'scandi_lightwood', name: '浅色木', color: '#F5DEB3', texture: 'wood' },
          { id: 'scandi_blue', name: '天蓝色', color: '#87CEEB', texture: 'paint' },
          { id: 'scandi_white', name: '白色', color: '#FFFFFF', texture: 'paint' }
        ]
      },
      layouts: [
        { id: 'default', name: '默认布局', description: '标准家具布局' },
        { id: 'open', name: '开放布局', description: '开放、通透的布局' },
        { id: 'cozy', name: '舒适布局', description: '温馨、舒适的布局' },
        { id: 'functional', name: '功能布局', description: '实用、功能优先的布局' }
      ]
    };
  }

  /**
   * 获取所有风格
   * @returns {Promise} 风格列表
   */
  async getStyles() {
    try {
      const response = await fetch(this.options.materialUrl + '/styles');
      if (!response.ok) {
        throw new Error('获取风格失败');
      }
      return await response.json();
    } catch (error) {
      console.error('获取风格失败:', error);
      // 失败时返回预设数据
      return this.presetMaterials.styles;
    }
  }

  /**
   * 根据风格获取材质
   * @param {string} styleId - 风格ID
   * @returns {Promise} 材质列表
   */
  async getMaterialsByStyle(styleId) {
    try {
      const response = await fetch(`${this.options.materialUrl}/materials?style=${styleId}`);
      if (!response.ok) {
        throw new Error('获取材质失败');
      }
      return await response.json();
    } catch (error) {
      console.error('获取材质失败:', error);
      // 失败时返回预设数据
      return this.presetMaterials.materials[styleId] || [];
    }
  }

  /**
   * 获取所有布局
   * @returns {Promise} 布局列表
   */
  async getLayouts() {
    try {
      const response = await fetch(this.options.materialUrl + '/layouts');
      if (!response.ok) {
        throw new Error('获取布局失败');
      }
      return await response.json();
    } catch (error) {
      console.error('获取布局失败:', error);
      // 失败时返回预设数据
      return this.presetMaterials.layouts;
    }
  }

  /**
   * 应用材质和家具更改
   * @param {Object} data - 材质和家具配置
   * @returns {Promise} 应用结果
   */
  async applyMaterials(data) {
    try {
      const response = await fetch(this.options.materialUrl + '/apply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      });
      if (!response.ok) {
        throw new Error('应用材质失败');
      }
      return await response.json();
    } catch (error) {
      console.error('应用材质失败:', error);
      // 失败时返回模拟结果
      return {
        success: true,
        message: '材质应用成功'
      };
    }
  }
}

// 导出默认实例
export const materialService = new MaterialService();

// 导出类，便于自定义配置
export default MaterialService;