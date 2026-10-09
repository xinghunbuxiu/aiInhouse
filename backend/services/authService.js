// 认证和授权服务
// 模块化设计，可独立替换

const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const storageService = require('./storageService');

class AuthService {
  constructor(options = {}) {
    this.options = {
      secretKey: options.secretKey || 'your-secret-key',
      tokenExpiry: options.tokenExpiry || '24h',
      ...options
    };
  }

  /**
   * 注册用户
   * @param {Object} userData - 用户数据
   * @returns {Promise} 注册结果
   */
  async register(userData) {
    const { email, password, name } = userData;
    
    if (!email || !password || !name) {
      return { success: false, error: '缺少必要参数' };
    }
    
    // 检查用户是否已存在
    const existingUser = await storageService.getUser(email);
    if (existingUser.success) {
      return { success: false, error: '用户已存在' };
    }
    
    // 哈希密码
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // 保存用户数据
    const user = {
      email,
      password: hashedPassword,
      name,
      role: 'user',
      createdAt: new Date().toISOString()
    };
    
    const result = await storageService.saveUser(email, user);
    if (result.success) {
      // 生成token
      const token = this.generateToken(email, user.role);
      return { success: true, message: '注册成功', token, user: { email, name, role: user.role } };
    } else {
      return { success: false, error: result.error };
    }
  }

  /**
   * 登录用户
   * @param {string} email - 邮箱
   * @param {string} password - 密码
   * @returns {Promise} 登录结果
   */
  async login(email, password) {
    if (!email || !password) {
      return { success: false, error: '缺少必要参数' };
    }
    
    // 获取用户数据
    const result = await storageService.getUser(email);
    if (!result.success) {
      return { success: false, error: '用户不存在' };
    }
    
    const user = result.data;
    
    // 验证密码
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return { success: false, error: '密码错误' };
    }
    
    // 生成token
    const token = this.generateToken(email, user.role);
    return { success: true, message: '登录成功', token, user: { email, name: user.name, role: user.role } };
  }

  /**
   * 生成JWT token
   * @param {string} email - 用户邮箱
   * @param {string} role - 用户角色
   * @returns {string} token
   */
  generateToken(email, role) {
    return jwt.sign(
      { email, role },
      this.options.secretKey,
      { expiresIn: this.options.tokenExpiry }
    );
  }

  /**
   * 验证JWT token
   * @param {string} token - token
   * @returns {Object} 验证结果
   */
  verifyToken(token) {
    try {
      const decoded = jwt.verify(token, this.options.secretKey);
      return { success: true, data: decoded };
    } catch (error) {
      console.error('验证token失败:', error);
      return { success: false, error: '无效的token' };
    }
  }

  /**
   * 检查用户权限
   * @param {string} role - 用户角色
   * @param {string} requiredRole - 所需角色
   * @returns {boolean} 是否有权限
   */
  checkPermission(role, requiredRole) {
    const roleHierarchy = {
      admin: 3,
      user: 2,
      guest: 1
    };
    
    return (roleHierarchy[role] || 0) >= (roleHierarchy[requiredRole] || 0);
  }
}

// 导出默认实例
const authService = new AuthService();
module.exports = authService;

// 导出类，便于自定义配置
module.exports.AuthService = AuthService;