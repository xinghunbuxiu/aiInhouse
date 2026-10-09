import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultOutputDir = path.join(root, 'downloads', 'kujiale-floorplans');
const searchEndpoint = 'https://www.kujiale.com/api/fphome/site/floorplan/search';
const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);

function getArg(flag, fallback = '') {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : (process.argv[index + 1] || fallback);
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath, fallback = null) {
  if (!filePath || !fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`读取 JSON 失败: ${filePath} ${error.message}`);
  }
}

function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function sanitizeFileName(value, fallback = 'floorplan') {
  const sanitized = String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return sanitized || fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
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

function loadHeaders() {
  const headersFile = getArg('--headers-file', process.env.KUJIALE_HEADERS_FILE || '');
  const curlFile = getArg('--curl-file', process.env.KUJIALE_CURL_FILE || '');
  const headersJson = process.env.KUJIALE_HEADERS_JSON || '';
  const cookie = getArg('--cookie', process.env.KUJIALE_COOKIE || '');

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

  return {
    ...baseHeaders,
    ...loaded,
    ...(cookie ? { cookie } : {})
  };
}

function normalizeAssetUrl(value) {
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

async function createKujialeDecoder() {
  const jsFile = getArg('--decode-js', process.env.KUJIALE_DECODE_JS || '');
  const wasmFile = getArg('--decode-wasm', process.env.KUJIALE_DECODE_WASM || '');
  if (!jsFile || !wasmFile) {
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

function isLikelyImageUrl(url) {
  if (!url) {
    return false;
  }
  const lower = url.toLowerCase();
  if (/\.(jpg|jpeg|png|webp|gif|avif)(?:[?#]|$)/.test(lower)) {
    return true;
  }
  return /image|img|pic|thumb|cover|floorplan|fphome|qhyxpic|qhimg|aliyuncs|oss|cdn/.test(lower);
}

function isLikelyEncodedKujialeImage(value) {
  return typeof value === 'string'
    && value.length > 40
    && /^[A-Za-z0-9]+$/.test(value)
    && /uU|up|uv|uK/.test(value);
}

function imageKeyScore(keyPath, url) {
  const text = `${keyPath} ${url}`.toLowerCase();
  let score = 0;
  if (/floor|plan|户型|house|image|img/.test(text)) score += 8;
  if (/origin|original|large|big|高清|source/.test(text)) score += 5;
  if (/cover|preview|thumb|thumbnail|small/.test(text)) score -= 3;
  if (/\.(png|webp)(?:[?#]|$)/.test(text)) score += 2;
  if (/\.(jpg|jpeg)(?:[?#]|$)/.test(text)) score += 1;
  return score;
}

function collectImageCandidates(value, keyPath = '', out = []) {
  if (!value) {
    return out;
  }
  if (typeof value === 'string') {
    const url = normalizeAssetUrl(value);
    if (isLikelyImageUrl(url)) {
      out.push({ keyPath, url, score: imageKeyScore(keyPath, url) });
    }
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectImageCandidates(item, `${keyPath}[${index}]`, out));
    return out;
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      collectImageCandidates(item, keyPath ? `${keyPath}.${key}` : key, out);
    }
  }
  return out;
}

function pickRecordId(record, index) {
  return record.id
    || record.fid
    || record.obsPlanId
    || record.planId
    || record.floorPlanId
    || record.houseId
    || record.obsDesignId
    || record.designId
    || `item-${index + 1}`;
}

function pickRecordName(record, index) {
  return record.name || record.title || record.communityName || record.houseName || record.layoutName || record.floorPlanName || `酷家乐户型-${index + 1}`;
}

function summarizeRecord(record, index, sourcePage) {
  const imageCandidates = collectImageCandidates(record)
    .sort((a, b) => b.score - a.score || b.url.length - a.url.length);
  const imageUrl = imageCandidates[0]?.url || '';
  const id = String(pickRecordId(record, index));
  const name = String(pickRecordName(record, index));
  return {
    id,
    name,
    sourcePage,
    area: record.area || record.houseArea || record.buildArea || record.square || '',
    room: record.room || record.houseType || record.layout || record.specsInfo || record.roomText || '',
    city: record.city || record.cityName || '',
    community: record.community || record.communityName || record.commName || record.resblockName || '',
    imageUrl,
    encodedImages: {
      imageUrl: isLikelyEncodedKujialeImage(record.imageUrl) ? record.imageUrl : '',
      wallCenterLine: isLikelyEncodedKujialeImage(record.wallCenterLine) ? record.wallCenterLine : '',
      withoutDimensionLine: isLikelyEncodedKujialeImage(record.withoutDimensionLine) ? record.withoutDimensionLine : '',
      insideTheWall: isLikelyEncodedKujialeImage(record.insideTheWall) ? record.insideTheWall : ''
    },
    imageCandidates,
    raw: record
  };
}

function findLikelyRecords(payload) {
  const arrays = [];

  function visit(value, keyPath = '') {
    if (!value || typeof value !== 'object') {
      return;
    }
    if (Array.isArray(value)) {
      const objectItems = value.filter((item) => item && typeof item === 'object' && !Array.isArray(item));
      const imageItemCount = objectItems.filter((item) => collectImageCandidates(item).length).length;
      const encodedImageItemCount = objectItems.filter((item) => (
        isLikelyEncodedKujialeImage(item.imageUrl)
        || isLikelyEncodedKujialeImage(item.wallCenterLine)
        || isLikelyEncodedKujialeImage(item.withoutDimensionLine)
        || isLikelyEncodedKujialeImage(item.insideTheWall)
      )).length;
      if (objectItems.length && (imageItemCount || encodedImageItemCount)) {
        arrays.push({
          keyPath,
          items: objectItems,
          score: imageItemCount * 3 + encodedImageItemCount * 4 + objectItems.length + (/list|data|result|floor/i.test(keyPath) ? 10 : 0)
        });
      }
      value.forEach((item, index) => visit(item, `${keyPath}[${index}]`));
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      visit(item, keyPath ? `${keyPath}.${key}` : key);
    }
  }

  visit(payload);
  const best = arrays.sort((a, b) => b.score - a.score)[0];
  return best?.items || [];
}

function extractTotal(payload) {
  const direct = payload?.d?.total ?? payload?.data?.total ?? payload?.total;
  const total = Number(direct);
  return Number.isFinite(total) ? total : 0;
}

async function resolveRecordImage(record, decodeKujialeString) {
  if (record.imageUrl) {
    record.resolvedImageSource = 'direct-url';
    return record.imageUrl;
  }

  if (!decodeKujialeString) {
    return '';
  }

  const preferredKeys = ['wallCenterLine', 'withoutDimensionLine', 'insideTheWall', 'imageUrl'];
  for (const key of preferredKeys) {
    const encoded = record.encodedImages?.[key];
    if (!encoded) {
      continue;
    }
    try {
      const decoded = normalizeAssetUrl(await decodeKujialeString(encoded));
      if (isLikelyImageUrl(decoded)) {
        record.imageUrl = decoded;
        record.resolvedImageSource = `decoded-${key}`;
        return decoded;
      }
    } catch (error) {
      record.decodeError = `${key}: ${error.message}`;
    }
  }

  return '';
}

async function fetchJson(url, headers) {
  const response = await fetch(url, { headers });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${url} HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${url} 返回不是 JSON: ${text.slice(0, 300)}`);
  }
}

async function downloadFile(url, targetPath, headers, dryRun) {
  if (dryRun) {
    return { skipped: true, bytes: 0 };
  }
  const response = await fetch(url, {
    headers: {
      ...headers,
      accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
    }
  });
  if (!response.ok) {
    throw new Error(`${url} HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, buffer);
  return { skipped: false, bytes: buffer.length };
}

function extensionFromUrl(url, contentType = '') {
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    if (imageExtensions.has(ext)) {
      return ext;
    }
  } catch (_) {
    // Fall through to content type.
  }
  if (/png/i.test(contentType)) return '.png';
  if (/webp/i.test(contentType)) return '.webp';
  if (/gif/i.test(contentType)) return '.gif';
  return '.jpg';
}

function buildSearchUrl({ keyword, areaId, areaLevel, num, page }) {
  const url = new URL(searchEndpoint);
  url.searchParams.set('locale', 'zh_CN');
  url.searchParams.set('start', String((page - 1) * num));
  url.searchParams.set('keyword', keyword);
  url.searchParams.set('area_id', String(areaId));
  url.searchParams.set('area_level', String(areaLevel));
  url.searchParams.set('num', String(num));
  url.searchParams.set('page', String(page));
  return url.toString();
}

async function main() {
  const keyword = getArg('--keyword', '尊爵里');
  const areaId = getArg('--area-id', '92');
  const areaLevel = getArg('--area-level', '2');
  const pages = parseNumber(getArg('--pages', '1'), 1);
  const maxPages = parseNumber(getArg('--max-pages', String(pages)), pages);
  const num = parseNumber(getArg('--num', '20'), 20);
  const delayMs = parseNumber(getArg('--delay-ms', '600'), 600);
  const outputDir = path.resolve(getArg('--output', defaultOutputDir));
  const dryRun = hasFlag('--dry-run');
  const allPages = hasFlag('--all-pages');
  const headers = loadHeaders();
  const decodeKujialeString = await createKujialeDecoder();

  ensureDir(outputDir);
  ensureDir(path.join(outputDir, 'raw'));
  ensureDir(path.join(outputDir, 'images'));

  const records = [];
  const seen = new Set();
  const errors = [];

  let total = 0;
  let requestedPages = allPages ? Math.max(1, maxPages) : pages;
  for (let page = 1; page <= requestedPages; page += 1) {
    const url = buildSearchUrl({ keyword, areaId, areaLevel, num, page });
    const payload = await fetchJson(url, headers);
    total = total || extractTotal(payload);
    if (allPages && total > 0) {
      requestedPages = Math.min(Math.ceil(total / num), Math.max(1, maxPages));
    }
    writeJson(path.join(outputDir, 'raw', `search-page-${page}.json`), payload);

    const pageRecords = findLikelyRecords(payload).map((record, index) => summarizeRecord(record, index, page));
    for (const record of pageRecords) {
      await resolveRecordImage(record, decodeKujialeString);
      const signature = record.id || record.imageUrl || JSON.stringify(record.raw).slice(0, 120);
      if ((!record.imageUrl && !Object.values(record.encodedImages || {}).some(Boolean)) || seen.has(signature)) {
        continue;
      }
      seen.add(signature);
      records.push(record);
    }

    if (page < requestedPages) {
      await sleep(delayMs);
    }
  }

  for (const [index, record] of records.entries()) {
    const ext = extensionFromUrl(record.imageUrl);
    const fileName = `${String(index + 1).padStart(3, '0')}-${sanitizeFileName(record.name)}-${sanitizeFileName(record.id)}${ext}`;
    const targetPath = path.join(outputDir, 'images', fileName);
    record.localFile = targetPath;
    try {
      const result = await downloadFile(record.imageUrl, targetPath, headers, dryRun);
      record.download = result;
    } catch (error) {
      record.download = { skipped: false, bytes: 0, error: error.message };
      errors.push({ id: record.id, name: record.name, imageUrl: record.imageUrl, error: error.message });
    }
    await sleep(Math.max(100, Math.floor(delayMs / 2)));
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    keyword,
    areaId,
    areaLevel,
    pages: requestedPages,
    total,
    num,
    dryRun,
    count: records.length,
    downloaded: records.filter((record) => record.download && !record.download.error).length,
    errors,
    records
  };
  writeJson(path.join(outputDir, 'manifest.json'), manifest);

  console.log(JSON.stringify({
    outputDir,
    count: manifest.count,
    downloaded: manifest.downloaded,
    errors: errors.length,
    manifest: path.join(outputDir, 'manifest.json')
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
