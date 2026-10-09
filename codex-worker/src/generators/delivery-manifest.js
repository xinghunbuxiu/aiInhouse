const fs = require('fs');
const path = require('path');

function readPngDimensions(buffer) {
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') {
    return null;
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function readJpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset < buffer.length - 9) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) {
      return null;
    }

    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7)
      };
    }

    offset += 2 + length;
  }

  return null;
}

function readWebpDimensions(buffer) {
  if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
    return null;
  }

  const chunk = buffer.toString('ascii', 12, 16);
  if (chunk === 'VP8X' && buffer.length >= 30) {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3)
    };
  }

  if (chunk === 'VP8 ' && buffer.length >= 30) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff
    };
  }

  if (chunk === 'VP8L' && buffer.length >= 25) {
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1
    };
  }

  return null;
}

function readImageDimensions(filePath, format) {
  if (!['png', 'jpg', 'jpeg', 'webp'].includes(format)) {
    return null;
  }

  const buffer = fs.readFileSync(filePath);
  return readPngDimensions(buffer)
    || readJpegDimensions(buffer)
    || readWebpDimensions(buffer)
    || null;
}

function fileInfo(outputDir, fileName) {
  if (!fileName || typeof fileName !== 'string') {
    return null;
  }

  const filePath = path.isAbsolute(fileName) ? fileName : path.join(outputDir, fileName);
  if (!fs.existsSync(filePath)) {
    return {
      file: fileName,
      exists: false,
      sizeBytes: 0,
      format: path.extname(fileName).replace(/^\./, '').toLowerCase()
    };
  }

  const stat = fs.statSync(filePath);
  const format = path.extname(fileName).replace(/^\./, '').toLowerCase();
  const dimensions = readImageDimensions(filePath, format);
  return {
    file: fileName,
    exists: true,
    sizeBytes: stat.size,
    format,
    ...(dimensions ? {
      width: dimensions.width,
      height: dimensions.height,
      aspectRatio: Number((dimensions.width / Math.max(dimensions.height, 1)).toFixed(3))
    } : {})
  };
}

function isRasterImage(file = {}) {
  return file.exists && ['png', 'jpg', 'jpeg', 'webp'].includes(file.format);
}

function isCommercialEffectImage(file = {}) {
  return isRasterImage(file) && Number(file.width || 0) >= 1600 && Number(file.height || 0) >= 1000;
}

function isCommercialPanoramaImage(file = {}) {
  const ratio = Number(file.aspectRatio || 0);
  return isRasterImage(file)
    && Number(file.width || 0) >= 2048
    && Number(file.height || 0) >= 1024
    && Math.abs(ratio - 2) <= 0.02;
}

function readJson(outputDir, fileName, fallback = null) {
  const filePath = path.join(outputDir, fileName);
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return fallback;
  }
}

function readOrCreateApproval(outputDir, job) {
  const approvalPath = path.join(outputDir, 'delivery-approval.json');
  const fallbackApproval = {
    version: '0.1.0',
    jobNo: job?.job?.job_no || '',
    humanApproved: false,
    licenseApproved: false,
    approver: '',
    approvedAt: '',
    notes: '将 humanApproved 和 licenseApproved 改为 true，并填写 approver / approvedAt 后，才允许进入 commercial_ready。'
  };

  if (!fs.existsSync(approvalPath)) {
    fs.writeFileSync(approvalPath, JSON.stringify(fallbackApproval, null, 2), 'utf8');
    return fallbackApproval;
  }

  try {
    return {
      ...fallbackApproval,
      ...JSON.parse(fs.readFileSync(approvalPath, 'utf8'))
    };
  } catch (error) {
    return fallbackApproval;
  }
}

function collectAssetLicenseSummary(outputDir) {
  const assemblyPlan = readJson(outputDir, 'scene-assembly-plan.json', {});
  const assets = assemblyPlan.rendererAssets || [];
  const seen = new Map();

  for (const asset of assets) {
    if (!asset?.id || seen.has(asset.id)) {
      continue;
    }
    seen.set(asset.id, {
      id: asset.id,
      name: asset.name || '',
      category: asset.category || '',
      sourceType: asset.sourceType || 'manual',
      sourceUrl: asset.sourceUrl || '',
      license: asset.license || '',
      hasModel: Boolean(asset.modelUrl),
      hasTexture: Boolean(asset.textureUrl),
      hasPreview: Boolean(asset.previewUrl)
    });
  }

  const list = [...seen.values()];
  const missingLicense = list.filter((asset) => !asset.license);
  const externalAssets = list.filter((asset) => asset.sourceType && !['procedural', 'manual'].includes(asset.sourceType));

  return {
    total: list.length,
    externalCount: externalAssets.length,
    missingLicenseCount: missingLicense.length,
    assets: list
  };
}

function uniqueFiles(files = []) {
  const seen = new Map();
  for (const file of files.filter(Boolean)) {
    const key = file.file || '';
    if (!key || seen.has(key)) {
      continue;
    }
    seen.set(key, file);
  }
  return [...seen.values()];
}

function generateDeliveryManifest(job, outputDir, result, summary, rooms = []) {
  const recognitionReadiness = job?.runtimeHints?.recognitionDraft?.quality?.commercialReadiness
    || summary?.commercialReadiness
    || {};
  const threeDConfig = readJson(outputDir, '3d-config.json', {});
  const panoramaConfig = readJson(outputDir, 'panorama-config.json', {});
  const openAiResult = readJson(outputDir, 'openai-image-render-result.json', {});
  const blenderResult = readJson(outputDir, 'blender-render-result.json', {});
  const autoRenderResult = readJson(outputDir, 'aiinhouse-auto-render-result.json', {});
  const rasterizeResult = readJson(outputDir, 'rasterize-render-result.json', {});
  const formalPlan = readJson(outputDir, 'formal-plan.json', {});
  const approval = readOrCreateApproval(outputDir, job);
  const assetLicenses = collectAssetLicenseSummary(outputDir);
  const effectImages = [
    ...(threeDConfig.deliverables?.effectImages || []),
    ...(threeDConfig.deliverables?.birdseyeImages || []),
    ...(threeDConfig.deliverables?.interiorImages || []),
    result?.output?.effectImage,
    result?.output?.renderImage,
    result?.output?.birdseyeImage,
    ...(Array.isArray(result?.output?.interiorImages) ? result.output.interiorImages : []),
    openAiResult?.output?.effectImage,
    openAiResult?.output?.renderImage,
    openAiResult?.output?.birdseyeImage,
    ...(Array.isArray(openAiResult?.output?.interiorImages) ? openAiResult.output.interiorImages : []),
    rasterizeResult?.output?.effectImage,
    rasterizeResult?.output?.renderImage,
    rasterizeResult?.output?.birdseyeImage,
    ...(Array.isArray(rasterizeResult?.output?.interiorImages) ? rasterizeResult.output.interiorImages : [])
  ].map((fileName) => fileInfo(outputDir, fileName));
  const panoramaImages = [
    ...(panoramaConfig.deliverables?.panoramaImages || []),
    result?.output?.panoramaImage,
    result?.output?.equirectangularImage,
    openAiResult?.output?.panoramaImage,
    openAiResult?.output?.equirectangularImage,
    rasterizeResult?.output?.panoramaImage,
    rasterizeResult?.output?.equirectangularImage
  ].map((fileName) => fileInfo(outputDir, fileName));
  const formalFiles = [
    result?.output?.formalPlanSvg,
    result?.output?.formalPlanJson,
    result?.output?.cadFile,
    result?.output?.recognitionDiagnostics
  ].map((fileName) => fileInfo(outputDir, fileName));
  const hasRasterEffect = uniqueFiles(effectImages).some(isRasterImage);
  const hasRasterPanorama = uniqueFiles(panoramaImages).some(isRasterImage);
  const hasRasterBirdseye = uniqueFiles(effectImages).some((file) => isRasterImage(file) && /birdseye/i.test(file.file || ''));
  const hasRasterInterior = uniqueFiles(effectImages).some((file) => isRasterImage(file) && /interior/i.test(file.file || ''));
  const verifiedEffectImages = [
    openAiResult?.output?.effectImage,
    openAiResult?.output?.renderImage,
    openAiResult?.output?.birdseyeImage,
    ...(Array.isArray(openAiResult?.output?.interiorImages) ? openAiResult.output.interiorImages : []),
    blenderResult?.output?.effectImage,
    blenderResult?.output?.renderImage,
    blenderResult?.output?.birdseyeImage,
    ...(Array.isArray(blenderResult?.output?.interiorImages) ? blenderResult.output.interiorImages : [])
  ].map((fileName) => fileInfo(outputDir, fileName));
  const verifiedPanoramaImages = [
    openAiResult?.output?.panoramaImage,
    openAiResult?.output?.equirectangularImage,
    blenderResult?.output?.panoramaImage,
    blenderResult?.output?.equirectangularImage
  ].map((fileName) => fileInfo(outputDir, fileName));
  const hasCommercialEffect = uniqueFiles(verifiedEffectImages).some(isCommercialEffectImage);
  const hasCommercialPanorama = uniqueFiles(verifiedPanoramaImages).some(isCommercialPanoramaImage);
  const aiDirectSucceeded = Boolean(openAiResult?.summary?.effectImage || openAiResult?.summary?.panoramaImage);
  const blenderSucceeded = Boolean(blenderResult?.summary || blenderResult?.output?.effectImage || blenderResult?.output?.panoramaImage);
  const previewFallbackUsed = Boolean(
    autoRenderResult?.summary?.previewFallbackUsed
    || autoRenderResult?.summary?.autoRenderer?.provider === 'aiinhouse-rasterize-renderer'
    || threeDConfig?.renderer?.fallbackResult
    || panoramaConfig?.viewer?.fallbackResult
  );
  const hasCommercial3DSpec = Boolean(threeDConfig.renderer?.commercialRenderSpec);
  const hasCommercialVRSpec = Boolean(panoramaConfig.viewer?.commercialVrSpec);
  const hasCommercial3D = hasCommercial3DSpec && threeDConfig.renderStatus === 'ready_for_render';
  const hasCommercialVR = hasCommercialVRSpec && panoramaConfig.tourStatus === 'ready_for_vr';
  const cameraCount = panoramaConfig.cameraPositions?.length || 0;
  const hotspotCount = panoramaConfig.hotspots?.length || 0;
  const roomCount = formalPlan.rooms?.length || rooms.length || 0;
  const humanApproved = Boolean(approval.humanApproved) || String(process.env.CODEX_DELIVERY_HUMAN_APPROVED || '').toLowerCase() === 'true';
  const licenseApproved = Boolean(approval.licenseApproved) || String(process.env.CODEX_DELIVERY_LICENSE_APPROVED || '').toLowerCase() === 'true';
  const recognitionCommercialReady = recognitionReadiness.status === 'commercial_ready' && Boolean(recognitionReadiness.autoPass);
  const commercialReady = Boolean(
    recognitionCommercialReady
    && summary.hasFormalPlan
    && summary.hasThreeD
    && summary.hasPanorama
    && hasCommercialEffect
    && hasCommercialPanorama
    && hasCommercial3D
    && hasCommercialVR
    && cameraCount >= roomCount
    && hotspotCount >= roomCount
    && humanApproved
    && licenseApproved
  );

  const manifest = {
    version: '0.1.0',
    jobNo: job?.job?.job_no || '',
    floorPlanId: job?.floor_plan?.id || null,
    generatedAt: new Date().toISOString(),
    deliveryStatus: commercialReady ? 'commercial_ready' : 'preview_ready',
    commercialReady,
    summary: {
      ...summary,
      commercialReadiness: recognitionReadiness,
      roomCount,
      cameraCount,
      hotspotCount,
      hasRasterEffect,
      hasRasterBirdseye,
      hasRasterInterior,
      hasRasterPanorama,
      hasCommercialEffect,
      hasCommercialPanorama,
      hasCommercial3D,
      hasCommercialVR,
      hasCommercial3DSpec,
      hasCommercialVRSpec,
      renderStatus: threeDConfig.renderStatus || '',
      tourStatus: panoramaConfig.tourStatus || '',
      renderProvenance: {
        aiDirectSucceeded,
        blenderSucceeded,
        previewFallbackUsed,
        verifiedCommercialRenderer: aiDirectSucceeded ? 'openai-image-api' : (blenderSucceeded ? 'blender' : null)
      }
    },
    files: {
      formal: uniqueFiles(formalFiles),
      effectImages: uniqueFiles(effectImages),
      panoramaImages: uniqueFiles(panoramaImages),
      approval: fileInfo(outputDir, 'delivery-approval.json')
    },
    renderer: {
      provider: threeDConfig.provider || '',
      openAiImageResult: openAiResult?.summary || null,
      blenderResult: blenderResult?.summary || null,
      autoRenderResult: autoRenderResult?.summary || null,
      rasterizeResult: rasterizeResult?.summary || null,
      commercialRenderSpec: threeDConfig.renderer?.commercialRenderSpec || null,
      acceptanceCriteria: threeDConfig.renderer?.acceptanceCriteria || []
    },
    vr: {
      provider: panoramaConfig.provider || '',
      commercialVrSpec: panoramaConfig.viewer?.commercialVrSpec || null,
      acceptanceCriteria: panoramaConfig.viewer?.acceptanceCriteria || []
    },
    license: {
      policy: '仅可使用自有、项目授权或明确可商用素材；最终发布前需保存模型、贴图、图片和家具素材来源。',
      needsHumanApproval: !humanApproved,
      humanApproved,
      licenseApproved,
      approvalFile: 'delivery-approval.json',
      approver: approval.approver || '',
      approvedAt: approval.approvedAt || '',
      notes: approval.notes || ''
    },
    assets: {
      licenseSummary: assetLicenses
    },
    gates: [
      {
        id: 'recognition-commercial-readiness',
        label: '平面图识别通过商用门禁',
        passed: recognitionCommercialReady,
        details: {
          status: recognitionReadiness.status || 'unknown',
          score: recognitionReadiness.score ?? null,
          blockingReasons: recognitionReadiness.blockingReasons || []
        }
      },
      { id: 'formal-plan', label: '正式平面图完整', passed: Boolean(summary.hasFormalPlan && roomCount > 0) },
      { id: 'effect-raster', label: '存在 PNG/JPG/WebP 效果预览图', passed: hasRasterEffect },
      { id: 'birdseye-raster', label: '存在 PNG/JPG/WebP 俯瞰预览图', passed: hasRasterBirdseye || hasRasterEffect },
      { id: 'interior-raster', label: '真实 PNG/JPG/WebP 室内观赏图', passed: hasRasterInterior },
      { id: 'verified-renderer', label: '效果图来自 AI 图片服务或 Blender 渲染', passed: aiDirectSucceeded || blenderSucceeded },
      { id: 'effect-resolution', label: '可信渲染效果图不低于 1600x1000', passed: hasCommercialEffect },
      { id: 'panorama-raster', label: '存在 PNG/JPG/WebP 全景预览图', passed: hasRasterPanorama },
      { id: 'panorama-resolution', label: '可信渲染全景图不低于 2048x1024 且为 2:1', passed: hasCommercialPanorama },
      { id: 'vr-coverage', label: 'VR 相机位和热点覆盖所有空间', passed: cameraCount >= roomCount && hotspotCount >= roomCount },
      { id: 'commercial-spec', label: '商用渲染和 VR 验收规格存在', passed: hasCommercial3D && hasCommercialVR },
      { id: 'human-approval', label: '人工终审确认', passed: humanApproved },
      { id: 'license-approval', label: '素材授权确认', passed: licenseApproved }
    ]
  };

  fs.writeFileSync(path.join(outputDir, 'delivery-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return manifest;
}

module.exports = {
  generateDeliveryManifest
};
