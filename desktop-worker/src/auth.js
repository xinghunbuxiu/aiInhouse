const { apiJson } = require('./api');
const config = require('./config');

let cachedToken = '';

async function getAccessToken() {
  if (cachedToken) {
    return cachedToken;
  }

  if (config.authMode === 'mock') {
    cachedToken = 'mock-token-12345';
    return cachedToken;
  }

  if (config.token) {
    cachedToken = config.token;
    return config.token;
  }

  if (!config.username || !config.password) {
    cachedToken = 'mock-token-12345';
    return 'mock-token-12345';
  }

  try {
    const response = await apiJson('/auth/login', {
      method: 'POST',
      body: {
        username: config.username,
        password: config.password
      }
    });

    if (!response?.success || !response?.data?.token) {
      throw new Error(response?.message || '登录失败');
    }

    cachedToken = response.data.token;
    return response.data.token;
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      if (config.authMode === 'login') {
        console.warn(`桌面 worker 登录失败，已回退到开发令牌: ${error.message}`);
      }
      cachedToken = 'mock-token-12345';
      return 'mock-token-12345';
    }

    throw error;
  }
}

module.exports = {
  getAccessToken
};
