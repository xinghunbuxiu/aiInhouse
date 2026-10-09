// 平面图解析服务
// 模块化设计，可独立替换

class ParseService {
  constructor(options = {}) {
    this.options = {
      parseUrl: options.parseUrl || 'http://localhost:8000/api/parse',
      ...options
    };
  }

  /**
   * 解析平面图
   * @param {string} filename - 文件名
   * @returns {Promise} 解析结果
   */
  async parse(filename) {
    if (!filename) {
      throw new Error('缺少文件名');
    }

    try {
      console.log('尝试解析文件:', filename);
      console.log('API地址:', this.options.parseUrl);
      
      const response = await fetch(this.options.parseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ filename })
      });

      if (!response.ok) {
        throw new Error(`解析失败：${response.statusText}`);
      }

      const result = await response.json();
      console.log('API解析成功:', result);
      return result;
    } catch (error) {
      console.error('解析失败:', error);
      console.log('使用模拟数据');
      // 失败时返回模拟数据
      return this.mockParse(filename);
    }
  }

  /**
   * 模拟解析（用于开发和测试）
   * @param {string} filename - 文件名
   * @returns {Object} 模拟解析结果
   */
  mockParse(filename) {
    console.log('使用模拟解析数据 for:', filename);
    
    // 模拟解析结果
    const result = {
      success: true,
      rooms: [
        {
          id: 1,
          name: '客厅',
          width: 4.5,
          length: 5.0,
          walls: [
            { id: 1, length: 5.0, type: 'exterior' },
            { id: 2, length: 4.5, type: 'interior' },
            { id: 3, length: 5.0, type: 'exterior' },
            { id: 4, length: 4.5, type: 'interior' }
          ],
          doors: [
            { id: 1, position: { x: 2.25, y: 0 }, width: 0.9 }
          ],
          windows: [
            { id: 1, position: { x: 1.5, y: 5.0 }, width: 1.5 },
            { id: 2, position: { x: 3.0, y: 5.0 }, width: 1.5 }
          ]
        },
        {
          id: 2,
          name: '卧室',
          width: 3.5,
          length: 4.0,
          walls: [
            { id: 5, length: 4.0, type: 'interior' },
            { id: 6, length: 3.5, type: 'exterior' },
            { id: 7, length: 4.0, type: 'interior' },
            { id: 8, length: 3.5, type: 'exterior' }
          ],
          doors: [
            { id: 2, position: { x: 1.75, y: 0 }, width: 0.9 }
          ],
          windows: [
            { id: 3, position: { x: 1.0, y: 4.0 }, width: 1.5 }
          ]
        },
        {
          id: 3,
          name: '厨房',
          width: 3.0,
          length: 3.5,
          walls: [
            { id: 9, length: 3.5, type: 'interior' },
            { id: 10, length: 3.0, type: 'exterior' },
            { id: 11, length: 3.5, type: 'interior' },
            { id: 12, length: 3.0, type: 'exterior' }
          ],
          doors: [
            { id: 3, position: { x: 1.5, y: 0 }, width: 0.9 }
          ],
          windows: [
            { id: 4, position: { x: 0.75, y: 3.5 }, width: 1.5 }
          ]
        }
      ],
      totalArea: 4.5 * 5.0 + 3.5 * 4.0 + 3.0 * 3.5
    };
    
    console.log('模拟解析结果:', result);
    return result;
  }

  /**
   * 验证解析结果
   * @param {Object} parseResult - 解析结果
   * @returns {Object} 验证结果
   */
  validateParseResult(parseResult) {
    if (!parseResult || !parseResult.success) {
      return { valid: false, error: '解析结果无效' };
    }

    if (!parseResult.rooms || !Array.isArray(parseResult.rooms)) {
      return { valid: false, error: '解析结果缺少房间信息' };
    }

    return { valid: true };
  }
}

// 导出默认实例
export const parseService = new ParseService();

// 导出类，便于自定义配置
export default ParseService;