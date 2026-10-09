import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function getArg(argv, flag, fallback = '') {
  const index = argv.indexOf(flag);
  return index === -1 ? fallback : argv[index + 1] || fallback;
}

export function hasFlag(argv, flag) {
  return argv.includes(flag);
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function readJson(filePath, fallback = null) {
  if (!filePath || !fs.existsSync(filePath)) {
    return fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

export function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

export function sanitizeFileName(value, fallback = 'item') {
  return String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function headerObjectFromCurlText(text) {
  const headers = {};
  const headerPattern = /-H\s+(['"])(.*?)\1/g;
  let match = headerPattern.exec(text);
  while (match) {
    const line = match[2];
    const separatorIndex = line.indexOf(':');
    if (separatorIndex !== -1) {
      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();
      if (key && !/^sec-|^priority$/i.test(key)) {
        headers[key] = value;
      }
    }
    match = headerPattern.exec(text);
  }
  const cookieMatch = text.match(/(?:^|\s)-b\s+(['"])(.*?)\1/);
  if (cookieMatch) {
    headers.cookie = cookieMatch[2];
  }
  return headers;
}

export function loadKujialeAuth(argv = process.argv.slice(2)) {
  const headersFile = getArg(argv, '--headers-file', process.env.KUJIALE_HEADERS_FILE || '');
  const curlFile = getArg(argv, '--curl-file', process.env.KUJIALE_CURL_FILE || '');
  const headersJson = process.env.KUJIALE_HEADERS_JSON || '';
  const cookie = getArg(argv, '--cookie', process.env.KUJIALE_COOKIE || '');
  const accessToken = getArg(argv, '--access-token', process.env.KUJIALE_ACCESS_TOKEN || '');

  const configCandidates = [
    path.join(root, '.kjlconfig.json'),
    path.join(root, 'scripts', 'kujiale-3d.config.json')
  ];

  let config = {};
  for (const file of configCandidates) {
    const next = readJson(file, null);
    if (next) {
      config = { ...config, ...next };
    }
  }

  const baseHeaders = {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    referer: 'https://www.kujiale.com/',
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
  };

  let loaded = {};
  if (headersJson) {
    loaded = JSON.parse(headersJson);
  } else if (headersFile) {
    loaded = readJson(path.resolve(headersFile), {});
  } else if (curlFile) {
    loaded = headerObjectFromCurlText(fs.readFileSync(path.resolve(curlFile), 'utf8'));
  }

  const token = accessToken || config.access_token || config.accessToken || '';
  const configHeaders = config.headers && typeof config.headers === 'object' ? config.headers : {};
  const merged = {
    ...baseHeaders,
    ...configHeaders,
    ...loaded,
    ...(cookie ? { cookie } : {}),
    ...(config.cookie ? { cookie: config.cookie } : {}),
    ...(token ? { 'x-token': token, 'x-access-token': token } : {})
  };

  return {
    headers: merged,
    accessToken: token,
    hasAuth: Boolean(merged.cookie || token)
  };
}

export async function createKujialeDecoder(argv = process.argv.slice(2)) {
  const jsFile = getArg(argv, '--decode-js', process.env.KUJIALE_DECODE_JS || path.join(root, 'downloads', 'kujiale-decoder-test', 'kjlTool.js'));
  const wasmFile = getArg(argv, '--decode-wasm', process.env.KUJIALE_DECODE_WASM || path.join(root, 'downloads', 'kujiale-decoder-test', 'optimized.wasm'));
  if (!fs.existsSync(jsFile) || !fs.existsSync(wasmFile)) {
    return null;
  }

  const jsCode = fs.readFileSync(path.resolve(jsFile), 'utf8');
  const wasmBase64 = fs.readFileSync(path.resolve(wasmFile)).toString('base64');
  const context = {
    WebAssembly,
    Uint8Array,
    Uint16Array,
    Uint32Array,
    BigUint64Array,
    String,
    Error,
    Symbol,
    console
  };
  vm.createContext(context);
  vm.runInContext(jsCode, context);
  await vm.runInContext(`initBinaryData(${JSON.stringify(wasmBase64)})`, context);

  return async (text) => {
    if (!text || typeof text !== 'string') {
      return '';
    }
    return vm.runInContext(`decodeString(${JSON.stringify(text)})`, context);
  };
}

export function normalizeAssetUrl(value) {
  if (!value || typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  if (!trimmed || /^data:/i.test(trimmed)) {
    return '';
  }
  if (/^\/\//.test(trimmed)) {
    return `https:${trimmed}`;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith('/')) {
    return `https://www.kujiale.com${trimmed}`;
  }
  return '';
}

export function extensionFromUrl(url, contentType = '') {
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.json'].includes(ext)) {
      return ext;
    }
  } catch (_) {
    // ignore
  }
  if (/json/i.test(contentType)) return '.json';
  if (/svg/i.test(contentType)) return '.svg';
  if (/png/i.test(contentType)) return '.png';
  if (/webp/i.test(contentType)) return '.webp';
  return '.jpg';
}

export async function fetchText(url, headers = {}) {
  const response = await fetch(url, { headers });
  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    contentType: response.headers.get('content-type') || '',
    text
  };
}

export async function downloadBinary(url, targetPath, headers = {}, dryRun = false) {
  if (dryRun) {
    return { skipped: true, bytes: 0, targetPath };
  }
  const response = await fetch(url, {
    headers: {
      ...headers,
      accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,application/json,*/*;q=0.8'
    }
  });
  if (!response.ok) {
    throw new Error(`${url} HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, buffer);
  return { skipped: false, bytes: buffer.length, targetPath };
}

export function collectManifestRecords(floorplansRoot) {
  const records = [];
  if (!fs.existsSync(floorplansRoot)) {
    return records;
  }

  const stack = [floorplansRoot];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.name !== 'manifest.json') {
        continue;
      }
      const manifest = readJson(fullPath, null);
      if (!manifest?.records?.length) {
        continue;
      }
      const communityDir = path.dirname(fullPath);
      for (const record of manifest.records) {
        records.push({
          ...record,
          communityDir,
          manifestPath: fullPath,
          keyword: manifest.keyword || '',
          areaId: manifest.areaId || ''
        });
      }
    }
  }

  const seen = new Set();
  return records.filter((record) => {
    const key = record.id || record.raw?.obsDesignId || record.raw?.obsPlanId;
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function buildDesignEndpoints(designId, options = {}) {
  const id = encodeURIComponent(designId);
  const appId = encodeURIComponent(options.appId || '');
  const endpoints = [
    { id: 'lds-itemId2bgId-session', url: 'https://yun.kujiale.com/lds/api/query/itemId2bgId' },
    { id: 'lds-itemId2bgId', url: `https://yun.kujiale.com/lds/api/query/itemId2bgId?designid=${id}` },
    { id: 'dds-designdata-yun', url: `https://yun.kujiale.com/dds/api/c/designdata?designid=${id}` },
    { id: 'dds-homedesign-yun', url: `https://yun.kujiale.com/dds/api/c/homedesign?designid=${id}` },
    { id: 'dds-floorplans-unit-yun', url: `https://yun.kujiale.com/dds/api/c/floorplans/unit?designid=${id}` },
    { id: 'session-v2-yun', url: `https://yun.kujiale.com/d/api/session/v2?designid=${id}` },
    { id: 'dds-designdata-www', url: `https://www.kujiale.com/dds/api/c/designdata?designid=${id}` },
    { id: 'dds-homedesign-www', url: `https://www.kujiale.com/dds/api/c/homedesign?designid=${id}` },
    { id: 'dds-floorplans-unit-www', url: `https://www.kujiale.com/dds/api/c/floorplans/unit?designid=${id}` },
    { id: 'session-v2-www', url: `https://www.kujiale.com/d/api/session/v2?designid=${id}` }
  ];

  if (appId && appId !== id) {
    endpoints.splice(1, 0,
      { id: 'lds-itemId2bgId-app', url: `https://yun.kujiale.com/lds/api/query/itemId2bgId?designid=${appId}` },
      { id: 'bim-homedesign-app', url: `https://yun.kujiale.com/dds/api/c/homedesign?designid=${appId}` },
      { id: 'bim-designdata-app', url: `https://yun.kujiale.com/dds/api/c/designdata?designid=${appId}` },
      { id: 'bim-session-app', url: `https://yun.kujiale.com/d/api/session/v2?designid=${appId}` }
    );
  }

  return endpoints;
}
