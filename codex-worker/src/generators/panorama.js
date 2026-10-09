const fs = require('fs');
const path = require('path');
const config = require('../config');
const { normalizeOutput, runExternalRenderer } = require('./external-renderer');
const { generatePanoramaImage } = require('./local-renderer');
const { runRasterFallback } = require('./raster-fallback');
const { generateVrTourFiles, pickPanoramaImage } = require('./vr-tour');

function uniqueList(items = []) {
  return [...new Set(items.filter(Boolean))];
}

function roomCenter(room = {}) {
  return {
    x: Number(room.x || 0) + Number(room.width || 0) / 2,
    z: Number(room.y || 0) + Number(room.height || 0) / 2
  };
}

async function generatePanoramaConfig(job, outputDir, rooms = []) {
  const parseResult = job?.floor_plan?.parse_result || {};
  const generated3DConfig = parseResult.generated3DConfig || {};
  const recognitionReadiness = job?.runtimeHints?.recognitionDraft?.quality?.commercialReadiness || {};
  const tourStatus = recognitionReadiness.status && recognitionReadiness.status !== 'commercial_ready'
    ? 'review_required'
    : 'ready_for_vr';
  const panoramaConfig = {
    version: '0.1.0',
    jobNo: job.job.job_no,
    description: '基于正式平面图自动生成的全景 VR 漫游配置',
    provider: config.panoramaProvider,
    tourStatus,
    recognitionReadiness,
    viewer: {
      provider: 'pannellum',
      commercialVrSpec: {
        imageType: 'equirectangular',
        aspectRatio: '2:1',
        minWidth: 2048,
        minHeight: 1024,
        recommendedWidth: 4096,
        recommendedHeight: 2048,
        hotspotPolicy: '每个可进入空间至少一个导航热点；不可进入空间需在复核报告说明。'
      },
      acceptanceCriteria: [
        '若 recognitionReadiness.status 不是 commercial_ready，本 VR 配置只能用于内部复核，不可作为准确户型发布。',
        '全景图必须是 2:1 等距柱状图，能在 Pannellum 中正常加载。',
        '热点文字必须对应真实房间名称。',
        '相机位不得穿墙或落在柜体、洁具、家具内部。',
        '客户发布前需检查门窗、动线和隐私区域展示范围。'
      ],
      recommendedEngines: [
        {
          name: 'Pannellum',
          url: 'https://pannellum.org/',
          useCase: '轻量开源 Web 全景查看器，适合直接交付 VR 漫游热点配置。'
        },
        {
          name: 'Blender equirectangular render',
          url: 'https://www.blender.org/',
          useCase: '适合从 3D 场景批量渲染 2:1 等距柱状全景图。'
        }
      ]
    },
    cameraPositions: rooms.map((room, index) => {
      const center = roomCenter(room);
      return {
      id: `cam-${index + 1}`,
      name: `${room.name} 机位`,
      roomId: room.id,
      position: { x: Number((center.x / 100).toFixed(2)), y: 1.65, z: Number((center.z / 100).toFixed(2)) },
      target: { x: Number((center.x / 100).toFixed(2)), y: 1.2, z: Number((center.z / 100).toFixed(2)) },
      roomType: room.type || 'space'
    };
    }),
    hotspots: rooms.map((room, index) => ({
      id: `hotspot-${index + 1}`,
      type: 'navigation',
      text: `前往${room.name}`,
      target: `cam-${((index + 1) % Math.max(rooms.length, 1)) + 1}`,
      roomId: room.id,
      position: { pitch: -6 + (index % 3) * 3, yaw: -150 + index * Math.round(300 / Math.max(rooms.length, 1)) }
    })),
    deliverables: {
      panoramaConfig: 'panorama-config.json',
      panoramaImages: [],
      vrTourFiles: []
    }
  };

  const localPanoramaImage = generatePanoramaImage({
    outputDir,
    rooms,
    colors: generated3DConfig.colors || {},
    materials: generated3DConfig.materials || {}
  });
  panoramaConfig.deliverables.panoramaImages.push(localPanoramaImage);
  const filePath = path.join(outputDir, 'panorama-config.json');
  fs.writeFileSync(filePath, JSON.stringify(panoramaConfig, null, 2), 'utf8');

  if (config.panoramaCommand) {
    try {
      const result = await runExternalRenderer(
        config.panoramaCommand,
        [
          '--job', path.resolve(outputDir, 'job-context.json'),
          '--panorama', path.join(outputDir, 'panorama-config.json'),
          '--assembly-plan', path.join(outputDir, 'scene-assembly-plan.json'),
          '--output', outputDir
        ],
        config.panoramaTimeoutMs,
        outputDir,
        {
          CODEX_PANORAMA_PROVIDER: config.panoramaProvider,
          CODEX_PANORAMA_ENDPOINT: config.panoramaEndpoint,
          CODEX_PANORAMA_API_KEY: config.panoramaApiKey
        }
      );
      const output = normalizeOutput(result?.output || result, outputDir);
      panoramaConfig.deliverables.panoramaImages = uniqueList([
        ...panoramaConfig.deliverables.panoramaImages,
        output.panoramaImage,
        output.equirectangularImage,
        output.previewImage
      ]);
      panoramaConfig.deliverables.vrTourFiles = uniqueList([output.tourFile, output.htmlFile, output.packageFile]);
      panoramaConfig.viewer.externalResult = result?.summary || null;
    } catch (error) {
      panoramaConfig.viewer.externalError = error.message;
      try {
        const fallback = runRasterFallback(outputDir, { panorama: true });
        const output = normalizeOutput(fallback.output || {}, outputDir);
        panoramaConfig.deliverables.panoramaImages = uniqueList([
          ...panoramaConfig.deliverables.panoramaImages,
          output.panoramaImage,
          output.equirectangularImage,
          output.previewImage
        ]);
        panoramaConfig.viewer.fallbackResult = fallback.summary || null;
      } catch (fallbackError) {
        panoramaConfig.viewer.fallbackError = fallbackError.message;
      }
    }

    fs.writeFileSync(filePath, JSON.stringify(panoramaConfig, null, 2), 'utf8');
  }

  panoramaConfig.deliverables.primaryPanoramaImage = pickPanoramaImage(panoramaConfig, outputDir);
  panoramaConfig.deliverables.vrTourFiles = uniqueList([
    ...panoramaConfig.deliverables.vrTourFiles,
    ...generateVrTourFiles(outputDir, panoramaConfig)
  ]);
  fs.writeFileSync(filePath, JSON.stringify(panoramaConfig, null, 2), 'utf8');

  return filePath;
}

module.exports = {
  generatePanoramaConfig
};
