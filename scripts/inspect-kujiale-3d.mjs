import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ensureDir, writeJson } from './lib/kujiale-shared.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataRoot = path.join(root, 'backend/uploads/floorplans/kujiale-3d');
const manifestPath = path.join(root, 'backend/uploads/floorplans/manifest.json');
const outputRoot = path.join(root, 'tmp/kujiale-3d-inspect');

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function hexPreview(buffer, n = 24) {
  return buffer.slice(0, n).toString('hex').match(/.{1,2}/g)?.join(' ') || '';
}

function guessBinaryKind(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) return 'gzip';
  if (buffer.length >= 4 && buffer[0] === 0x28 && buffer[1] === 0xb5 && buffer[2] === 0x2f && buffer[3] === 0xfd) return 'brotli';
  if (buffer.length >= 2 && buffer[0] === 0x7b) return 'maybe-json-text';
  return 'opaque-binary';
}

function summarizeJsonFile(filePath) {
  const payload = readJsonSafe(filePath);
  if (!payload) return { error: 'invalid-json' };
  const data = payload.d ?? payload.data ?? payload.result;
  if (Array.isArray(data)) {
    return { topLevel: Object.keys(payload), arrayLength: data.length };
  }
  if (data && typeof data === 'object') {
    const keys = Object.keys(data);
    return {
      topLevel: Object.keys(payload),
      objectKeys: keys.length,
      sampleKeys: keys.slice(0, 8)
    };
  }
  return { topLevel: Object.keys(payload) };
}

function scanDesignDir(designDir) {
  const designId = path.basename(designDir);
  const record = readJsonSafe(path.join(designDir, 'record.json'));
  const apiDir = path.join(designDir, 'api');
  const viewsDir = path.join(designDir, 'views');
  const apiFiles = fs.existsSync(apiDir)
    ? fs.readdirSync(apiDir).map((name) => {
      const filePath = path.join(apiDir, name);
      const stat = fs.statSync(filePath);
      const ext = path.extname(name).toLowerCase();
      if (ext === '.json') {
        return {
          name,
          bytes: stat.size,
          kind: 'json',
          summary: summarizeJsonFile(filePath)
        };
      }
      const buffer = fs.readFileSync(filePath);
      return {
        name,
        bytes: stat.size,
        kind: 'binary',
        md5: crypto.createHash('md5').update(buffer).digest('hex'),
        binaryKind: guessBinaryKind(buffer),
        hexHead: hexPreview(buffer)
      };
    })
    : [];

  const viewFiles = fs.existsSync(viewsDir)
    ? fs.readdirSync(viewsDir).map((name) => {
      const filePath = path.join(viewsDir, name);
      const stat = fs.statSync(filePath);
      return { name, bytes: stat.size };
    })
    : [];

  return {
    designId,
    hasRecord: Boolean(record),
    recordSummary: record ? {
      status: record.status,
      apiHits: record.apiHits,
      viewCount: record.viewCount,
      obsDesignId: record.obsDesignId
    } : null,
    apiFiles,
    viewFiles,
    viewCount: viewFiles.length,
    apiCount: apiFiles.length
  };
}

function buildManifestIndex() {
  const manifest = readJsonSafe(manifestPath);
  if (!Array.isArray(manifest)) return new Map();
  const index = new Map();
  for (const item of manifest) {
    if (item.obsDesignId) {
      index.set(item.obsDesignId, {
        name: item.name,
        area: item.area,
        rooms: item.rooms,
        isBim: item.isBim
      });
    }
  }
  return index;
}

function writeReport(summary) {
  const lines = [
    '# 酷家乐 3D 本地数据巡检',
    '',
    `- 扫描目录: ${summary.dataRoot}`,
    `- 设计目录数: ${summary.designCount}`,
    `- 有 API 文件: ${summary.withApiCount}`,
    `- 有结构视图: ${summary.withViewsCount}`,
    `- homedesign 二进制: ${summary.homedesignCount}`,
    `- itemId2bgId JSON: ${summary.itemId2bgIdCount}`,
    '',
    '## 二进制 homedesign 体积分布',
    '',
    ...summary.homedesignSizes.map((row) => `- ${row.designId}: ${row.bytes} bytes, md5=${row.md5}`),
    '',
    '## JSON 样本',
    '',
    ...summary.jsonSamples.map((row) => `- ${row.designId}/${row.name}: ${JSON.stringify(row.summary)}`),
    '',
    '## 结构视图样本',
    '',
    ...summary.viewSamples.map((row) => `- ${row.designId}: ${row.viewCount} 张, 示例 ${row.names.join(', ')}`),
    '',
    '## 结论',
    '',
    summary.verdict
  ];
  fs.writeFileSync(path.join(outputRoot, 'report.md'), lines.join('\n'), 'utf8');
}

function main() {
  ensureDir(outputRoot);
  if (!fs.existsSync(dataRoot)) {
    const empty = { error: 'data-root-missing', dataRoot };
    writeJson(path.join(outputRoot, 'summary.json'), empty);
    console.log(JSON.stringify(empty, null, 2));
    return;
  }

  const manifestIndex = buildManifestIndex();
  const designDirs = fs.readdirSync(dataRoot)
    .map((name) => path.join(dataRoot, name))
    .filter((dir) => fs.statSync(dir).isDirectory());

  const designs = designDirs.map(scanDesignDir).map((design) => ({
    ...design,
    manifest: manifestIndex.get(design.designId) || null
  }));

  const homedesignSizes = [];
  const jsonSamples = [];
  const viewSamples = [];

  for (const design of designs) {
    for (const file of design.apiFiles) {
      if (/homedesign/i.test(file.name) && file.kind === 'binary') {
        homedesignSizes.push({
          designId: design.designId,
          bytes: file.bytes,
          md5: file.md5
        });
      }
      if (file.kind === 'json') {
        jsonSamples.push({
          designId: design.designId,
          name: file.name,
          summary: file.summary
        });
      }
    }
    if (design.viewCount > 0) {
      viewSamples.push({
        designId: design.designId,
        viewCount: design.viewCount,
        names: design.viewFiles.slice(0, 4).map((item) => item.name)
      });
    }
  }

  const uniqueHomedesignMd5 = new Set(homedesignSizes.map((row) => row.md5));
  const uniqueHomedesignBytes = new Set(homedesignSizes.map((row) => row.bytes));

  const summary = {
    generatedAt: new Date().toISOString(),
    dataRoot,
    designCount: designs.length,
    withApiCount: designs.filter((row) => row.apiCount > 0).length,
    withViewsCount: designs.filter((row) => row.viewCount > 0).length,
    homedesignCount: homedesignSizes.length,
    itemId2bgIdCount: jsonSamples.filter((row) => /itemId2bgId/i.test(row.name)).length,
    homedesignSizes: homedesignSizes.slice(0, 20),
    jsonSamples: jsonSamples.slice(0, 20),
    viewSamples: viewSamples.slice(0, 20),
    uniqueHomedesignMd5: [...uniqueHomedesignMd5],
    uniqueHomedesignBytes: [...uniqueHomedesignBytes],
    designs: designs.slice(0, 30),
    verdict: [
      homedesignSizes.length
        ? `已保存 ${homedesignSizes.length} 份 homedesign 二进制，体积去重后 ${uniqueHomedesignBytes.size} 种，MD5 去重后 ${uniqueHomedesignMd5.size} 种。`
        : '本地还没有 homedesign 二进制，可先跑 npm run kujiale:3d:session。',
      jsonSamples.length
        ? `已有 ${jsonSamples.length} 份 JSON，主要是 itemId2bgId 的 itemId→bgId 映射。`
        : '本地还没有 JSON API 响应。',
      viewSamples.length
        ? `已有 ${viewSamples.length} 个户型的结构视图（wallCenterLine 等 4 张图）。`
        : '本地还没有结构视图，可先跑 npm run kujiale:3d:all-views。'
    ].join('\n')
  };

  writeJson(path.join(outputRoot, 'summary.json'), summary);
  writeReport(summary);
  console.log(JSON.stringify({
    outputRoot,
    designCount: summary.designCount,
    homedesignCount: summary.homedesignCount,
    itemId2bgIdCount: summary.itemId2bgIdCount,
    withViewsCount: summary.withViewsCount,
    report: path.join(outputRoot, 'report.md')
  }, null, 2));
}

main();
