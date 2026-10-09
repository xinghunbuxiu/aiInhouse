const { backendUrl, apiTimeoutMs } = require('./config');

function buildUrl(endpoint) {
  if (/^https?:\/\//.test(endpoint)) {
    return endpoint;
  }

  return `${backendUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
}

async function parseResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const message = payload?.message || response.statusText || '请求失败';
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

async function apiRequest(endpoint, options = {}) {
  const headers = {
    ...(options.headers || {})
  };
  const controller = new AbortController();
  const timeoutMs = Math.max(Number(options.timeoutMs || apiTimeoutMs || 8000), 1000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  try {
    const response = await fetch(buildUrl(endpoint), {
      method: options.method || 'GET',
      headers,
      body: options.body,
      signal: controller.signal
    });

    return await parseResponse(response);
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error(`请求超时（${timeoutMs}ms）`);
      timeoutError.code = 'REQUEST_TIMEOUT';
      throw timeoutError;
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function apiJson(endpoint, { method = 'GET', token, body } = {}) {
  return apiRequest(endpoint, {
    method,
    token,
    headers: {
      'Content-Type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

module.exports = {
  apiRequest,
  apiJson,
  buildUrl
};
