import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildDesignEndpoints,
  collectManifestRecords,
  createKujialeDecoder,
  downloadBinary,
  ensureDir,
  extensionFromUrl,
  getArg,
  hasFlag,
  loadKujialeAuth,
  normalizeAssetUrl,
  sanitizeFileName,
  sleep,
  writeJson
} from './lib/kujiale-shared.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);

function parseJsonResponse(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function isUsefulJson(payload) {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  if (payload.c === '0' || payload.c === 0) {
    return Boolean(payload.d);
  }
  if (payload.data) {
    return true;
  }
  return Object.keys(payload).length > 2;
}

function isUsefulBinary(endpointId, status, buffer) {
  return status === 200
    && buffer?.length > 0
    && /homedesign|designdata/i.test(endpointId)
    && !String(buffer.slice(0, 1)).startsWith('{');
}

async function resolveEncodedViews(record, decodeKujialeString) {
  const encodedImages = record.encodedImages || {
    imageUrl: record.raw?.imageUrl || '',
    wallCenterLine: record.raw?.wallCenterLine || '',
    withoutDimensionLine: record.raw?.withoutDimensionLine || '',
    insideTheWall: record.raw?.insideTheWall || ''
  };

  const views = [];
  const preferredKeys = ['wallCenterLine', 'withoutDimensionLine', 'insideTheWall', 'imageUrl'];
  for (const key of preferredKeys) {
    const encoded = encodedImages[key];
    if (!encoded || !decodeKujialeString) {
      continue;
    }
    try {
      const decoded = normalizeAssetUrl(await decodeKujialeString(encoded));
      if (decoded) {
        views.push({ key, url: decoded, source: `decoded-${key}` });
      }
    } catch (error) {
      views.push({ key, error: error.message, source: `decoded-${key}` });
    }
  }

  if (record.imageUrl) {
    views.push({ key: 'imageUrl', url: normalizeAssetUrl(record.imageUrl), source: 'direct-url' });
  }

  const deduped = [];
  const seen = new Set();
  for (const view of views) {
    if (!view.url || seen.has(view.url)) {
      continue;
    }
    seen.add(view.url);
    deduped.push(view);
  }
  return deduped;
}

async function downloadViews(record, outputDir, decodeKujialeString, headers, dryRun) {
  const designId = record.id || record.raw?.obsDesignId || record.raw?.obsPlanId;
  const viewsDir = path.join(outputDir, 'views');
  const views = await resolveEncodedViews(record, decodeKujialeString);
  const downloaded = [];

  for (const view of views) {
    const ext = extensionFromUrl(view.url);
    const targetPath = path.join(viewsDir, `${view.key}${ext}`);
    try {
      const result = await downloadBinary(view.url, targetPath, headers, dryRun);
      downloaded.push({
        ...view,
        localFile: targetPath,
        bytes: result.bytes,
        skipped: result.skipped
      });
    } catch (error) {
      downloaded.push({
        ...view,
        error: error.message
      });
    }
  }

  return downloaded;
}

async function probeDesignApis(designId, headers, outputDir, dryRun, options = {}) {
  const endpoints = buildDesignEndpoints(designId, options);
  const results = [];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint.url, {
        headers: {
          ...headers,
          accept: headers.accept || 'text/plain,*/*,application/json'
        }
      });
      const buffer = Buffer.from(await response.arrayBuffer());
      const text = buffer.toString('utf8');
      const payload = parseJsonResponse(text);
      const usefulBinary = isUsefulBinary(endpoint.endpoint || endpoint.id, response.status, buffer);
      const useful = response.ok && (isUsefulJson(payload) || usefulBinary);
      const targetPath = path.join(outputDir, 'api', `${endpoint.id}${usefulBinary ? '.bin' : '.json'}`);
      const record = {
        endpoint: endpoint.id,
        url: endpoint.url,
        status: response.status,
        contentType: response.headers.get('content-type') || '',
        useful,
        saved: false,
        bytes: buffer.length,
        preview: text.slice(0, 240)
      };

      if (useful && !dryRun) {
        if (usefulBinary) {
          ensureDir(path.dirname(targetPath));
          fs.writeFileSync(targetPath, buffer);
        } else {
          writeJson(targetPath, payload);
        }
        record.saved = true;
        record.localFile = targetPath;
        record.format = usefulBinary ? 'binary' : 'json';
      }

      results.push(record);
    } catch (error) {
      results.push({
        endpoint: endpoint.id,
        url: endpoint.url,
        error: error.message
      });
    }
  }

  return results;
}

function summarizeRecordResult(result) {
  const viewCount = (result.views || []).filter((view) => view.localFile).length;
  const apiHits = (result.apiProbes || []).filter((probe) => probe.useful);
  const hasHomeDesignBinary = apiHits.some((probe) => /homedesign/i.test(probe.endpoint) && probe.format === 'binary');
  return {
    designId: result.designId,
    name: result.name,
    isBim: Boolean(result.isBim),
    viewCount,
    apiHitCount: apiHits.length,
    hasHomeDesignBinary,
    threeDStatus: hasHomeDesignBinary
      ? 'homedesign_binary_ready'
      : apiHits.length
        ? 'api_json_ready'
        : result.hasAuth
          ? 'auth_present_but_no_3d_json'
          : 'views_only_auth_required_for_json',
    outputDir: result.outputDir
  };
}

async function main() {
  const floorplansRoot = path.resolve(getArg(argv, '--floorplans-root', path.join(root, 'backend/uploads/floorplans')));
  const outputRoot = path.resolve(getArg(argv, '--output', path.join(root, 'backend/uploads/floorplans/kujiale-3d')));
  const limitArg = getArg(argv, '--limit', '');
  const limit = limitArg === '' || limitArg === '0'
    ? Number.POSITIVE_INFINITY
    : Number(limitArg) || 20;
  const delayMs = Number(getArg(argv, '--delay-ms', '300')) || 300;
  const dryRun = hasFlag(argv, '--dry-run');
  const viewsOnly = hasFlag(argv, '--views-only');
  const apiOnly = hasFlag(argv, '--api-only');
  const sessionApp = hasFlag(argv, '--session-app');
  const designIdFilter = getArg(argv, '--design-id', '');
  const toolMode = getArg(argv, '--tool', '');
  const auth = loadKujialeAuth(argv);
  const sessionDesignId = designIdFilter || auth.headers['x-qh-appid'] || '';
  const resolvedTool = toolMode || auth.headers['x-tool-name'] || 'diy';
  if (sessionDesignId) {
    auth.headers['x-qh-appid'] = sessionDesignId;
    auth.headers['x-tool-name'] = resolvedTool;
    auth.headers.referer = resolvedTool === 'bim'
      ? `https://yun.kujiale.com/tool/h5/bim?designid=${sessionDesignId}&tre=000.000.001.zhuzhan.nav&gs.nav.type=auto-global&__rd=y&_gr_ds=true`
      : `https://yun.kujiale.com/cloud/tool/h5/diy?designid=${sessionDesignId}&redirectbim=false`;
  }
  const appId = sessionDesignId;
  const decodeKujialeString = await createKujialeDecoder(argv);

  if (!decodeKujialeString) {
    throw new Error('未找到酷家乐解码器，请确认 downloads/kujiale-decoder-test 存在。');
  }

  let records = collectManifestRecords(floorplansRoot);
  if (sessionApp && sessionDesignId) {
    records = [{
      id: sessionDesignId,
      name: `${resolvedTool.toUpperCase()}会话-${sessionDesignId}`,
      raw: { obsDesignId: sessionDesignId, isBim: true },
      manifestPath: '.kjlconfig.json'
    }];
  } else if (designIdFilter) {
    records = records.filter((record) => (record.id || record.raw?.obsDesignId) === designIdFilter);
  }
  records = records.slice(0, limit);

  if (!records.length) {
    throw new Error('未找到可处理的 manifest 记录。');
  }

  ensureDir(outputRoot);
  const results = [];

  for (const [index, record] of records.entries()) {
    const designId = record.id || record.raw?.obsDesignId || record.raw?.obsPlanId;
    const outputDir = path.join(outputRoot, sanitizeFileName(designId, 'design'));
    ensureDir(outputDir);

    const views = apiOnly ? [] : await downloadViews(record, outputDir, decodeKujialeString, auth.headers, dryRun);
    let apiProbes = [];
    if (!viewsOnly) {
      apiProbes = await probeDesignApis(designId, auth.headers, outputDir, dryRun, { appId });
    }

    const result = {
      index: index + 1,
      designId,
      name: record.name,
      room: record.room || record.raw?.specsInfo || '',
      area: record.area || record.raw?.buildArea || '',
      community: record.community || record.raw?.commName || '',
      isBim: Boolean(record.raw?.isBim),
      hasAuth: auth.hasAuth,
      outputDir,
      views,
      apiProbes,
      sourceManifest: record.manifestPath
    };
    writeJson(path.join(outputDir, 'record.json'), result);
    results.push(result);

    if (index < records.length - 1) {
      await sleep(delayMs);
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    floorplansRoot,
    outputRoot,
    total: results.length,
    dryRun,
    viewsOnly,
    apiOnly,
    sessionApp,
    hasAuth: auth.hasAuth,
    downloadedViews: results.reduce((sum, item) => sum + item.views.filter((view) => view.localFile).length, 0),
    apiJsonReady: results.filter((item) => item.apiProbes.some((probe) => probe.useful)).length,
    authRequired: !auth.hasAuth,
    records: results.map(summarizeRecordResult)
  };

  writeJson(path.join(outputRoot, 'batch-summary.json'), summary);
  console.log(JSON.stringify(summary, null, 2));

  if (!auth.hasAuth) {
    console.error('\n提示: 当前未配置酷家乐登录态，仅下载了结构视图。请创建 .kjlconfig.json 或设置 KUJIALE_COOKIE / KUJIALE_ACCESS_TOKEN 后再跑完整 3D JSON。');
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
