import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  buildDesignEndpoints,
  ensureDir,
  getArg,
  hasFlag,
  loadKujialeAuth,
  sanitizeFileName,
  sleep,
  writeJson
} from './lib/kujiale-shared.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);

const LDS_QUERIES = [
  'itemId2bgId',
  'bgId2itemId',
  'all',
  'design',
  'floorplan',
  'level',
  'levels',
  'room',
  'rooms',
  'wall',
  'walls',
  'opening',
  'openings',
  'door',
  'window',
  'furniture',
  'model',
  'models',
  'scene',
  'bim',
  'background',
  'backgrounds',
  'geometry',
  'mesh',
  'unit',
  'home',
  'homedesign',
  'designdata'
];

const DDS_PATHS = [
  'designdata',
  'homedesign',
  'floorplans/unit',
  'floorplan',
  'floorplan/data',
  'design',
  'design/data',
  'level',
  'room',
  'scene'
];

const CLOUD_TOOL_PREFIXES = [
  'https://yun.kujiale.com/cloud/tool/h5/diy/api',
  'https://yun.kujiale.com/cloud/tool/h5/bim/api',
  'https://yun.kujiale.com/tool/h5/diy/api',
  'https://yun.kujiale.com/tool/h5/bim/api'
];

function buildReferer(designId, tool) {
  return tool === 'bim'
    ? `https://yun.kujiale.com/tool/h5/bim?designid=${designId}&tre=000.000.001.zhuzhan.nav&gs.nav.type=auto-global&__rd=y&_gr_ds=true`
    : `https://yun.kujiale.com/cloud/tool/h5/diy?designid=${designId}&redirectbim=false`;
}

function buildAuthContext(designId, tool) {
  const auth = loadKujialeAuth(argv);
  auth.headers['x-qh-appid'] = designId;
  auth.headers['x-tool-name'] = tool;
  auth.headers.referer = buildReferer(designId, tool);
  auth.headers.accept = 'text/plain,*/*,application/json';
  auth.headers.origin = 'https://yun.kujiale.com';
  return auth;
}

function buildProbeEndpoints(designId) {
  const id = encodeURIComponent(designId);
  const endpoints = [];

  for (const query of LDS_QUERIES) {
    endpoints.push({
      group: 'lds',
      id: `lds-query-${query}`,
      url: `https://yun.kujiale.com/lds/api/query/${query}?designid=${id}`
    });
    endpoints.push({
      group: 'lds',
      id: `lds-query-${query}-plain`,
      url: `https://yun.kujiale.com/lds/api/query/${query}`
    });
  }

  for (const route of DDS_PATHS) {
    endpoints.push({
      group: 'dds',
      id: `dds-${route.replace(/\//g, '-')}-yun`,
      url: `https://yun.kujiale.com/dds/api/c/${route}?designid=${id}`
    });
    endpoints.push({
      group: 'dds',
      id: `dds-${route.replace(/\//g, '-')}-www`,
      url: `https://www.kujiale.com/dds/api/c/${route}?designid=${id}`
    });
  }

  const sessionRoutes = [
    'd/api/session/v2',
    'd/api/session',
    'd/api/design',
    'd/api/level',
    'geom/api/design',
    'geom/api/floorplan',
    'geom/api/background/query'
  ];
  for (const route of sessionRoutes) {
    endpoints.push({
      group: 'session',
      id: route.replace(/\//g, '-'),
      url: `https://yun.kujiale.com/${route}?designid=${id}`
    });
  }

  for (const prefix of CLOUD_TOOL_PREFIXES) {
    for (const name of ['designdata', 'homedesign', 'design', 'session', 'level', 'scene', 'floorplan']) {
      endpoints.push({
        group: 'cloud-tool',
        id: `${prefix.split('/').slice(-2).join('-')}-${name}`,
        url: `${prefix}/${name}?designid=${id}`
      });
    }
  }

  for (const endpoint of buildDesignEndpoints(designId, { appId: designId })) {
    endpoints.push({ group: 'known', ...endpoint });
  }

  const extraRoutes = [
    `https://yun.kujiale.com/dds/api/c/designdatas/create?designid=${id}`,
    `https://yun.kujiale.com/dds/api/c/i18nroomtypes?designid=${id}`,
    `https://yun.kujiale.com/cloud/design/${id}/panos`,
    `https://yun.kujiale.com/geom/api/background/query?designid=${id}`,
    `https://yun.kujiale.com/lds/api/query/all?designid=${id}`
  ];
  for (const url of extraRoutes) {
    endpoints.push({
      group: 'page-hint',
      id: url.replace(/https:\/\/yun\.kujiale\.com\//, '').replace(/[?=&]/g, '-'),
      url
    });
  }

  const seen = new Set();
  return endpoints.filter((endpoint) => {
    if (seen.has(endpoint.url)) {
      return false;
    }
    seen.add(endpoint.url);
    return true;
  });
}

function classifyBuffer(buffer, contentType = '') {
  const text = buffer.toString('utf8');
  if (/json/i.test(contentType) || (text.startsWith('{') && text.endsWith('}'))) {
    try {
      const payload = JSON.parse(text);
      return {
        kind: 'json',
        payload,
        text
      };
    } catch (_) {
      // fall through
    }
  }
  if (text.startsWith('<!DOCTYPE') || text.startsWith('<html')) {
    return { kind: 'html', text };
  }
  return { kind: 'binary', text };
}

function summarizeJson(payload) {
  if (!payload || typeof payload !== 'object') {
    return {};
  }
  const data = payload.d ?? payload.data ?? payload.result ?? null;
  if (Array.isArray(data)) {
    return { arrayLength: data.length };
  }
  if (data && typeof data === 'object') {
    return { objectKeys: Object.keys(data).length };
  }
  return { topLevelKeys: Object.keys(payload).slice(0, 12) };
}

function scoreResult(result) {
  let score = 0;
  if (result.status === 200) score += 5;
  if (result.kind === 'json') score += 10;
  if (result.kind === 'binary') score += 6;
  if (result.bytes >= 500) score += 8;
  if (result.bytes >= 5000) score += 12;
  if (result.jsonSummary?.objectKeys >= 10) score += 10;
  if (result.jsonSummary?.arrayLength >= 5) score += 8;
  if (/homedesign|designdata|floorplan|scene|level|room|wall/i.test(result.id)) score += 4;
  if (result.kind === 'html') score -= 10;
  return score;
}

async function fetchEndpoint(endpoint, headers) {
  const response = await fetch(endpoint.url, {
    method: 'GET',
    headers
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') || '';
  const classified = classifyBuffer(buffer, contentType);
  const md5 = crypto.createHash('md5').update(buffer).digest('hex');
  const jsonSummary = classified.kind === 'json' ? summarizeJson(classified.payload) : null;

  return {
    ...endpoint,
    status: response.status,
    contentType,
    bytes: buffer.length,
    md5,
    kind: classified.kind,
    jsonSummary,
    preview: classified.text.slice(0, 180).replace(/\s+/g, ' '),
    buffer,
    score: 0
  };
}

function saveResult(result, outputDir, saveAll) {
  const shouldSave = saveAll
    || result.status === 200
    || result.score >= 10
    || (result.kind !== 'html' && result.bytes > 0 && result.status !== 404);

  if (!shouldSave || result.kind === 'html') {
    return null;
  }

  const ext = result.kind === 'json' ? 'json' : 'bin';
  const fileName = sanitizeFileName(`${result.group}__${result.id}__${result.status}.${ext}`);
  const filePath = path.join(outputDir, 'responses', fileName);
  ensureDir(path.dirname(filePath));
  if (result.kind === 'json') {
    writeJson(filePath, JSON.parse(result.buffer.toString('utf8')));
  } else {
    fs.writeFileSync(filePath, result.buffer);
  }
  return filePath;
}

async function extractApiHints(designId, tool, headers, outputDir) {
  const pageUrl = buildReferer(designId, tool);
  const response = await fetch(pageUrl, { headers });
  const html = await response.text();
  const scriptSrc = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]);
  const inlineApis = [...html.matchAll(/\/(?:dds|lds|d|geom|cloud)\/[a-zA-Z0-9_\-/.?=&]+/g)].map((m) => m[0]);
  const uniqueApis = [...new Set(inlineApis)].slice(0, 80);

  const hints = {
    pageUrl,
    pageStatus: response.status,
    scriptCount: scriptSrc.length,
    scriptSamples: scriptSrc.slice(0, 15).map((src) => (
      src.startsWith('http') ? src : `https://yun.kujiale.com${src.startsWith('/') ? '' : '/'}${src}`
    )),
    inlineApiHints: uniqueApis
  };

  const jsHits = new Set();
  for (const scriptUrl of hints.scriptSamples.slice(0, 5)) {
    try {
      const jsResp = await fetch(scriptUrl, { headers });
      const js = await jsResp.text();
      const matches = js.match(/\/(?:dds|lds|d\/api|geom)[a-zA-Z0-9_\-/.?=&]+/g) || [];
      matches.slice(0, 40).forEach((item) => jsHits.add(item));
    } catch (_) {
      // ignore broken bundle fetch
    }
  }

  hints.jsApiHints = [...jsHits].slice(0, 80);
  writeJson(path.join(outputDir, 'page-api-hints.json'), hints);
  return hints;
}

function writeMarkdownReport(reportPath, report) {
  const top = [...report.results]
    .sort((a, b) => b.score - a.score)
    .slice(0, 25)
    .map((row) => (
      `| ${row.score} | ${row.status} | ${row.bytes} | ${row.kind} | ${row.id} | ${row.savedFile ? '已保存' : '-'} |`
    ))
    .join('\n');

  const saved = report.results.filter((row) => row.savedFile);
  const md = `# 酷家乐 3D 网络探测报告

- 设计 ID: ${report.designId}
- 工具页: ${report.tool}
- 探测时间: ${report.generatedAt}
- 登录态: ${report.hasAuth ? '是' : '否'}
- 探测接口数: ${report.results.length}
- 已保存响应: ${saved.length}

## 最有价值的响应

| 分数 | 状态 | 字节 | 类型 | 接口 | 文件 |
| ---: | ---: | ---: | --- | --- | --- |
${top || '| - | - | - | - | - | - |'}

## 页面里挖到的 API 线索

- 页面状态: ${report.pageHints?.pageStatus ?? '-'}
- 内联 API 线索: ${(report.pageHints?.inlineApiHints || []).slice(0, 10).join(', ') || '无'}
- JS 包 API 线索: ${(report.pageHints?.jsApiHints || []).slice(0, 10).join(', ') || '无'}

## 怎么读这些文件

- \`responses/*.json\`：可直接打开看结构，重点看 \`d\` / \`data\` 字段
- \`responses/*.bin\`：加密或压缩二进制，重点看体积是否明显大于 130 字节
- \`page-api-hints.json\`：从页面和 JS 包里提取出的接口线索

## 当前判断

${report.verdict}
`;
  fs.writeFileSync(reportPath, md, 'utf8');
}

function buildVerdict(results) {
  const jsonHits = results.filter((row) => row.kind === 'json' && row.status === 200);
  const largeBinary = results.filter((row) => row.kind === 'binary' && row.status === 200 && row.bytes >= 500);
  const tinyBinary = results.filter((row) => row.kind === 'binary' && row.status === 200 && row.bytes > 0 && row.bytes < 300);

  const lines = [];
  if (jsonHits.length) {
    lines.push(`- 已发现 ${jsonHits.length} 个 JSON 响应，优先查看 \`lds-itemId2bgId\` 一类映射数据。`);
  }
  if (largeBinary.length) {
    lines.push(`- 已发现 ${largeBinary.length} 个较大的二进制响应，可能接近真实 3D 场景包。`);
  } else if (tinyBinary.length) {
    lines.push('- 目前 homedesign 仅返回约 130 字节的加密种子包，完整 3D 场景还需要页面后续分片请求。');
  }
  if (!jsonHits.length && !largeBinary.length) {
    lines.push('- 本次没有抓到可直接解析的大块 3D JSON，建议更新 cookie 后重试，或换正在浏览器中打开的设计页。');
  }
  return lines.join('\n');
}

async function probeDesign(designId, tool, options) {
  const auth = buildAuthContext(designId, tool);
  const outputDir = path.join(options.outputRoot, `${sanitizeFileName(designId)}__${tool}`);
  ensureDir(outputDir);

  const endpoints = buildProbeEndpoints(designId);
  const results = [];

  const pageHints = await extractApiHints(designId, tool, auth.headers, outputDir);

  for (const [index, endpoint] of endpoints.entries()) {
    try {
      const result = await fetchEndpoint(endpoint, auth.headers);
      result.score = scoreResult(result);
      result.savedFile = saveResult(result, outputDir, options.saveAll);
      results.push({
        group: result.group,
        id: result.id,
        url: result.url,
        status: result.status,
        bytes: result.bytes,
        md5: result.md5,
        kind: result.kind,
        contentType: result.contentType,
        jsonSummary: result.jsonSummary,
        preview: result.preview,
        score: result.score,
        savedFile: result.savedFile
      });
    } catch (error) {
      results.push({
        group: endpoint.group,
        id: endpoint.id,
        url: endpoint.url,
        error: error.message,
        score: 0
      });
    }

    if (index < endpoints.length - 1) {
      await sleep(options.delayMs);
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    designId,
    tool,
    referer: auth.headers.referer,
    hasAuth: auth.hasAuth,
    endpointCount: endpoints.length,
    pageHints,
    verdict: buildVerdict(results),
    results
  };

  writeJson(path.join(outputDir, 'probe-report.json'), report);
  writeMarkdownReport(path.join(outputDir, 'probe-report.md'), report);
  return report;
}

async function main() {
  const outputRoot = path.resolve(getArg(argv, '--output', path.join(root, 'tmp', 'kujiale-3d-probe')));
  const delayMs = Number(getArg(argv, '--delay-ms', '80')) || 80;
  const saveAll = hasFlag(argv, '--save-all');
  const designArg = getArg(argv, '--design-id', '3FO4LEKIOLQM,3FO3E49PLJKD');
  const toolArg = getArg(argv, '--tool', 'diy,bim');
  const designIds = designArg.split(',').map((item) => item.trim()).filter(Boolean);
  const tools = toolArg.split(',').map((item) => item.trim()).filter(Boolean);

  ensureDir(outputRoot);
  const reports = [];

  for (const designId of designIds) {
    for (const tool of tools) {
      process.stderr.write(`探测 ${designId} (${tool})...\n`);
      const report = await probeDesign(designId, tool, { outputRoot, delayMs, saveAll });
      reports.push({
        designId,
        tool,
        outputDir: path.join(outputRoot, `${sanitizeFileName(designId)}__${tool}`),
        savedCount: report.results.filter((row) => row.savedFile).length,
        topHits: report.results
          .filter((row) => row.score >= 10)
          .sort((a, b) => b.score - a.score)
          .slice(0, 8)
          .map((row) => ({
            id: row.id,
            status: row.status,
            bytes: row.bytes,
            kind: row.kind,
            score: row.score
          })),
        verdict: report.verdict
      });
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    outputRoot,
    designIds,
    tools,
    reports
  };
  writeJson(path.join(outputRoot, 'summary.json'), summary);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
