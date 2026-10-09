const fs = require('fs');
const path = require('path');
const config = require('./config');
const { getAccessToken } = require('./auth');
const { registerDevice, heartbeat } = require('./device');
const { claimJob, startJob, appendJobLog, submitJobResult, submitJobFailure } = require('./jobs');
const { prepareWorkspace, appendWorkspaceLog, ensureDir } = require('./workspace');
const { downloadSourceAsset } = require('./downloader');
const { runCodexWorker } = require('./runner');
const { uploadArtifacts } = require('./uploader');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJson(filePath, fallback = null) {
  if (!filePath || !fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return fallback;
  }
}

function resolveOutputFile(outputDir, fileName) {
  if (!fileName || typeof fileName !== 'string') {
    return '';
  }

  return path.isAbsolute(fileName) ? fileName : path.resolve(outputDir, fileName);
}

function fileExists(outputDir, fileName) {
  const filePath = resolveOutputFile(outputDir, fileName);
  return Boolean(filePath && fs.existsSync(filePath));
}

function selectImage(outputDir, candidates = []) {
  const preferredExtensions = ['.png', '.jpg', '.jpeg', '.webp'];
  const existing = candidates
    .filter(Boolean)
    .map((fileName) => String(fileName))
    .filter((fileName, index, all) => all.indexOf(fileName) === index)
    .filter((fileName) => fileExists(outputDir, fileName));

  return existing.find((fileName) => /blender/i.test(path.basename(fileName)) && preferredExtensions.includes(path.extname(fileName).toLowerCase()))
    || existing.find((fileName) => preferredExtensions.includes(path.extname(fileName).toLowerCase()))
    || existing[0]
    || '';
}

function listInteriorImages(outputDir) {
  if (!outputDir || !fs.existsSync(outputDir)) {
    return [];
  }

  return fs.readdirSync(outputDir)
    .filter((fileName) => /^interior-.+-raster\.(png|jpg|jpeg|webp)$/i.test(fileName))
    .sort()
    .map((fileName) => path.resolve(outputDir, fileName));
}

function mapWorkerSummary(summary, outputDir) {
  const output = summary?.output || {};
  const threeDConfig = readJson(path.resolve(outputDir, output.threeDConfig || '3d-config.json'), {});
  const panoramaConfig = readJson(path.resolve(outputDir, output.panoramaConfig || 'panorama-config.json'), {});
  const renderResult = readJson(path.resolve(outputDir, 'aiinhouse-auto-render-result.json'), {})
    || readJson(path.resolve(outputDir, 'openai-image-render-result.json'), {})
    || readJson(path.resolve(outputDir, 'rasterize-render-result.json'), {});
  const effectImage = selectImage(outputDir, [
    output.effectImage,
    output.renderImage,
    renderResult?.output?.effectImage,
    renderResult?.output?.renderImage,
    renderResult?.output?.birdseyeImage,
    ...(threeDConfig?.deliverables?.effectImages || []),
    ...(threeDConfig?.deliverables?.birdseyeImages || [])
  ]);
  const birdseyeImage = selectImage(outputDir, [
    renderResult?.output?.birdseyeImage,
    ...(threeDConfig?.deliverables?.birdseyeImages || []),
    'birdseye-raster.png',
    effectImage
  ]);
  const interiorImages = listInteriorImages(outputDir).length
    ? listInteriorImages(outputDir)
    : (threeDConfig?.deliverables?.interiorImages || [])
      .filter((fileName) => fileExists(outputDir, fileName))
      .map((fileName) => resolveOutputFile(outputDir, fileName));
  const panoramaImage = selectImage(outputDir, [
    output.panoramaImage,
    output.equirectangularImage,
    renderResult?.output?.panoramaImage,
    renderResult?.output?.equirectangularImage,
    ...(panoramaConfig?.deliverables?.panoramaImages || [])
  ]);

  return {
    formalPlanSvg: resolveOutputFile(outputDir, output.formalPlanSvg),
    cadFile: resolveOutputFile(outputDir, output.cadFile),
    formalPlanJson: resolveOutputFile(outputDir, output.formalPlanJson),
    recognitionDiagnostics: resolveOutputFile(outputDir, output.recognitionDiagnostics || 'recognition-diagnostics.html'),
    recognitionOverlay: resolveOutputFile(outputDir, output.recognitionOverlay || 'recognition-overlay.svg'),
    recognitionEdges: resolveOutputFile(outputDir, output.recognitionEdges || 'vision-edges.png'),
    recognitionBinary: resolveOutputFile(outputDir, output.recognitionBinary || 'vision-binary.png'),
    recognitionWallBands: resolveOutputFile(outputDir, output.recognitionWallBands || 'vision-wall-bands.png'),
    recognitionStructuralWalls: resolveOutputFile(outputDir, output.recognitionStructuralWalls || 'vision-structural-wall-vectors.png'),
    recognitionBalconyCandidates: resolveOutputFile(outputDir, output.recognitionBalconyCandidates || 'vision-balcony-candidates.png'),
    recognitionRoomInteriors: resolveOutputFile(outputDir, output.recognitionRoomInteriors || 'vision-room-interiors.png'),
    recognitionWindowCandidates: resolveOutputFile(outputDir, output.recognitionWindowCandidates || 'vision-window-candidates.png'),
    recognitionDoorCandidates: resolveOutputFile(outputDir, output.recognitionDoorCandidates || 'vision-door-candidates.png'),
    recognitionSymbolCandidates: resolveOutputFile(outputDir, output.recognitionSymbolCandidates || 'vision-symbol-candidates.png'),
    threeDConfig: resolveOutputFile(outputDir, output.threeDConfig),
    panoramaConfig: resolveOutputFile(outputDir, output.panoramaConfig),
    deliveryManifest: resolveOutputFile(outputDir, output.deliveryManifest || 'delivery-manifest.json'),
    deliveryApproval: resolveOutputFile(outputDir, output.deliveryApproval || 'delivery-approval.json'),
    reviewFile: resolveOutputFile(outputDir, output.reviewFile),
    previewImage: resolveOutputFile(outputDir, birdseyeImage || effectImage || output.previewImage),
    effectImage: resolveOutputFile(outputDir, effectImage),
    birdseyeImage: resolveOutputFile(outputDir, birdseyeImage),
    interiorImages,
    panoramaImage: resolveOutputFile(outputDir, panoramaImage)
  };
}

async function processJob(token, jobPackage) {
  const paths = prepareWorkspace(jobPackage);
  appendWorkspaceLog(paths, `任务已入工作区: ${jobPackage.job.job_no}`);
  await appendJobLog(token, jobPackage.job.id, {
    stage: 'worker',
    level: 'info',
    message: '任务已写入本地工作区',
    payload: {
      job_dir: paths.jobDir
    }
  });

  const sourcePath = await downloadSourceAsset(jobPackage, paths, token);
  if (sourcePath) {
    const nextJob = {
      ...jobPackage,
      assets: {
        ...(jobPackage.assets || {}),
        local_source_file: sourcePath
      }
    };
    fs.writeFileSync(paths.jobFile, JSON.stringify(nextJob, null, 2), 'utf8');
    appendWorkspaceLog(paths, `已下载源图: ${sourcePath}`);
  }

  await startJob(token, jobPackage.job.id);
  await appendJobLog(token, jobPackage.job.id, {
    stage: 'worker',
    level: 'info',
    message: '本地处理器开始执行'
  });

  const execution = await runCodexWorker(paths);
  const outputFiles = mapWorkerSummary(execution.summary, paths.outputDir);
  const artifacts = await uploadArtifacts(token, jobPackage.job.id, outputFiles);

  await appendJobLog(token, jobPackage.job.id, {
    stage: 'upload',
    level: 'info',
    message: '产物已上传',
    payload: artifacts
  });

  const resultPayload = {
    processor: 'codex-desktop-worker',
    worker: {
      device_code: config.deviceCode,
      device_name: config.deviceName,
      app_version: config.appVersion
    },
    summary: execution.summary?.summary || execution.summary || {},
    artifacts
  };

  await submitJobResult(token, jobPackage.job.id, resultPayload);
  appendWorkspaceLog(paths, '任务执行完成并已回传结果');
}

async function runLoop({ once = false } = {}) {
  ensureDir(config.workspaceDir);
  const token = await getAccessToken();

  await registerDevice(token);
  await heartbeat(token, 'online');

  let stopped = false;
  const heartbeatTimer = setInterval(() => {
    heartbeat(token, 'online').catch((error) => {
      console.error('设备心跳失败:', error.message);
    });
  }, config.heartbeatIntervalMs);

  process.once('SIGINT', () => {
    stopped = true;
    clearInterval(heartbeatTimer);
  });

  process.once('SIGTERM', () => {
    stopped = true;
    clearInterval(heartbeatTimer);
  });

  while (!stopped) {
    try {
      const jobPackage = await claimJob(token);

      if (!jobPackage) {
        if (once) {
          break;
        }
        await sleep(config.pollIntervalMs);
        continue;
      }

      console.log(`领取任务: ${jobPackage.job.job_no} (${jobPackage.job.job_type})`);

      try {
        await processJob(token, jobPackage);
      } catch (error) {
        console.error(`任务失败 ${jobPackage.job.job_no}:`, error.message);
        await appendJobLog(token, jobPackage.job.id, {
          stage: 'worker',
          level: 'error',
          message: error.message,
          payload: {
            stack: error.stack || ''
          }
        }).catch(() => {});
        await submitJobFailure(token, jobPackage.job.id, error.message).catch(() => {});
      }

      if (once) {
        break;
      }
    } catch (error) {
      console.error('桌面 worker 循环异常:', error.message);
      if (once) {
        throw error;
      }
      await sleep(config.pollIntervalMs);
    }
  }

  clearInterval(heartbeatTimer);
}

const once = process.argv.includes('--once');

runLoop({ once }).catch((error) => {
  console.error(error);
  process.exit(1);
});
