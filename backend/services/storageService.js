// 数据存储服务
// 模块化设计，可独立替换

const fs = require('fs');
const path = require('path');

class StorageService {
  constructor(options = {}) {
    this.options = {
      storageDir: options.storageDir || path.join(__dirname, '../storage'),
      ...options
    };
    
    // 创建存储目录
    if (!fs.existsSync(this.options.storageDir)) {
      fs.mkdirSync(this.options.storageDir, { recursive: true });
    }
    
    // 创建子目录
    this.userDir = path.join(this.options.storageDir, 'users');
    this.designDir = path.join(this.options.storageDir, 'designs');
    
    if (!fs.existsSync(this.userDir)) {
      fs.mkdirSync(this.userDir, { recursive: true });
    }
    
    if (!fs.existsSync(this.designDir)) {
      fs.mkdirSync(this.designDir, { recursive: true });
    }
  }

  /**
   * 保存用户数据
   * @param {string} userId - 用户ID
   * @param {Object} userData - 用户数据
   * @returns {Promise} 保存结果
   */
  async saveUser(userId, userData) {
    try {
      const userPath = path.join(this.userDir, `${userId}.json`);
      fs.writeFileSync(userPath, JSON.stringify(userData, null, 2));
      return { success: true, message: '用户数据保存成功' };
    } catch (error) {
      console.error('保存用户数据失败:', error);
      return { success: false, error: '保存用户数据失败' };
    }
  }

  /**
   * 获取用户数据
   * @param {string} userId - 用户ID
   * @returns {Promise} 用户数据
   */
  async getUser(userId) {
    try {
      const userPath = path.join(this.userDir, `${userId}.json`);
      if (!fs.existsSync(userPath)) {
        return { success: false, error: '用户不存在' };
      }
      const userData = JSON.parse(fs.readFileSync(userPath, 'utf8'));
      return { success: true, data: userData };
    } catch (error) {
      console.error('获取用户数据失败:', error);
      return { success: false, error: '获取用户数据失败' };
    }
  }

  /**
   * 保存设计方案
   * @param {string} designId - 设计方案ID
   * @param {Object} designData - 设计方案数据
   * @returns {Promise} 保存结果
   */
  async saveDesign(designId, designData) {
    try {
      const designPath = path.join(this.designDir, `${designId}.json`);
      fs.writeFileSync(designPath, JSON.stringify(designData, null, 2));
      return { success: true, message: '设计方案保存成功' };
    } catch (error) {
      console.error('保存设计方案失败:', error);
      return { success: false, error: '保存设计方案失败' };
    }
  }

  /**
   * 获取设计方案
   * @param {string} designId - 设计方案ID
   * @returns {Promise} 设计方案数据
   */
  async getDesign(designId) {
    try {
      const designPath = path.join(this.designDir, `${designId}.json`);
      if (!fs.existsSync(designPath)) {
        return { success: false, error: '设计方案不存在' };
      }
      const designData = JSON.parse(fs.readFileSync(designPath, 'utf8'));
      return { success: true, data: designData };
    } catch (error) {
      console.error('获取设计方案失败:', error);
      return { success: false, error: '获取设计方案失败' };
    }
  }

  /**
   * 获取用户的所有设计方案
   * @param {string} userId - 用户ID
   * @returns {Promise} 设计方案列表
   */
  async getUserDesigns(userId) {
    try {
      const designs = [];
      const files = fs.readdirSync(this.designDir);
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const designPath = path.join(this.designDir, file);
          const designData = JSON.parse(fs.readFileSync(designPath, 'utf8'));
          if (designData.userId === userId) {
            designs.push(designData);
          }
        }
      }
      
      return { success: true, data: designs };
    } catch (error) {
      console.error('获取用户设计方案失败:', error);
      return { success: false, error: '获取用户设计方案失败' };
    }
  }

  /**
   * 删除设计方案
   * @param {string} designId - 设计方案ID
   * @returns {Promise} 删除结果
   */
  async deleteDesign(designId) {
    try {
      const designPath = path.join(this.designDir, `${designId}.json`);
      if (!fs.existsSync(designPath)) {
        return { success: false, error: '设计方案不存在' };
      }
      fs.unlinkSync(designPath);
      return { success: true, message: '设计方案删除成功' };
    } catch (error) {
      console.error('删除设计方案失败:', error);
      return { success: false, error: '删除设计方案失败' };
    }
  }
}

// 导出默认实例
const storageService = new StorageService();
module.exports = storageService;

// 导出类，便于自定义配置
module.exports.StorageService = StorageService;