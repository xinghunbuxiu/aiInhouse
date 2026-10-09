// 文件上传服务
// 模块化设计，可独立替换

class UploadService {
  constructor(options = {}) {
    this.options = {
      maxFileSize: options.maxFileSize || 10 * 1024 * 1024, // 10MB
      allowedTypes: options.allowedTypes || ['.jpg', '.jpeg', '.png', '.pdf', '.dwg'],
      uploadUrl: options.uploadUrl || '/api/upload',
      ...options
    };
  }

  /**
   * 验证文件
   * @param {File} file - 文件对象
   * @returns {Object} 验证结果
   */
  validateFile(file) {
    if (!file) {
      return { valid: false, error: '请选择文件' };
    }

    if (file.size > this.options.maxFileSize) {
      return { valid: false, error: `文件大小超过限制（最大${this.options.maxFileSize / (1024 * 1024)}MB）` };
    }

    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!this.options.allowedTypes.includes(ext)) {
      return { valid: false, error: `不支持的文件类型，仅支持${this.options.allowedTypes.join(', ')}` };
    }

    return { valid: true };
  }

  /**
   * 上传文件
   * @param {File} file - 文件对象
   * @param {Function} progressCallback - 进度回调函数
   * @returns {Promise} 上传结果
   */
  async upload(file, progressCallback) {
    const validation = this.validateFile(file);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    const formData = new FormData();
    formData.append('file', file);

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      // 进度回调
      if (progressCallback) {
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            const progress = Math.round((event.loaded / event.total) * 100);
            progressCallback(progress);
          }
        });
      }

      // 上传完成
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText);
            resolve(response);
          } catch (error) {
            reject(new Error('上传失败：无效的响应'));
          }
        } else {
          reject(new Error(`上传失败：${xhr.statusText}`));
        }
      });

      // 上传错误
      xhr.addEventListener('error', () => {
        reject(new Error('上传失败：网络错误'));
      });

      // 上传超时
      xhr.addEventListener('timeout', () => {
        reject(new Error('上传失败：超时'));
      });

      // 发送请求
      xhr.open('POST', this.options.uploadUrl);
      xhr.send(formData);
    });
  }

  /**
   * 模拟上传（用于开发和测试）
   * @param {File} file - 文件对象
   * @param {Function} progressCallback - 进度回调函数
   * @returns {Promise} 模拟上传结果
   */
  async mockUpload(file, progressCallback) {
    const validation = this.validateFile(file);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    return new Promise((resolve) => {
      let progress = 0;
      const interval = setInterval(() => {
        progress += 10;
        if (progressCallback) {
          progressCallback(progress);
        }
        if (progress >= 100) {
          clearInterval(interval);
          resolve({
            success: true,
            filename: file.name,
            path: `/uploads/${file.name}`,
            size: file.size
          });
        }
      }, 300);
    });
  }
}

// 导出默认实例
export const uploadService = new UploadService();

// 导出类，便于自定义配置
export default UploadService;