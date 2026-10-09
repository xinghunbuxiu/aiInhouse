const fs = require('fs');
const path = require('path');
const config = require('../config');
const { normalizeOutput, runExternalRenderer } = require('./external-renderer');
const { generateEffectRender, generateBirdseyeRender, generateInteriorViews } = require('./local-renderer');
const { runRasterFallback } = require('./raster-fallback');
const { buildAssemblyPlan } = require('./asset-library');

function uniqueList(items = []) {
  return [...new Set(items.filter(Boolean))];
}

function readJson(filePath, fallback = {}) {
  if (!filePath || !fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function buildStructuralWallShells(outputDir) {
  const preprocess = readJson(path.join(outputDir, 'recognition-preprocess.json'), {});
  const vectors = preprocess?.geometryCandidates?.structuralWallVectors || [];
  return vectors.map((wall, index) => ({
    id: wall.id || `structural-wall-${index + 1}`,
    type: 'extruded_wall_polygon',
    source: wall.source || 'structural-wall-mask',
    confidence: wall.confidence || 0.72,
    height: 2.8,
    baseZ: 0,
    bounds: {
      x: wall.x || 0,
      y: wall.y || 0,
      width: wall.width || 0,
      height: wall.height || 0
    },
    polygon2d: wall.polygon || [],
    material: 'structural-wall-painted',
    renderPolicy: 'extrude_polygon_from_source_image_coordinates'
  }));
}

function buildImageGenerationPrompt({ rooms = [], walls = [], style = 'modern-natural', recognitionReadiness = {} }) {
  const roomSummary = rooms
    .map((room) => `${room.name || room.id}: ${room.type || 'space'}, bounds x=${room.x || 0}, y=${room.y || 0}, w=${room.width || 0}, h=${room.height || 0}`)
    .join('; ');
  const readinessLine = recognitionReadiness.status && recognitionReadiness.status !== 'commercial_ready'
    ? `Recognition gate: ${recognitionReadiness.status}, score=${recognitionReadiness.score ?? 'unknown'}, reasons=${(recognitionReadiness.blockingReasons || []).join(', ') || 'none'}. Treat this as a review-required draft; do not present as final accurate construction geometry.`
    : 'Recognition gate: commercial-ready or not recorded; preserve source topology exactly.';

  return [
    'Use case: sketch-to-render',
    'Asset type: apartment top-down 3D interior effect render',
    `Primary request: Generate a furnished isometric / top-down 3D apartment render from the recognized floor plan. Style: ${style}.`,
    readinessLine,
    `Floor plan constraints: Preserve the exact recognized room topology and relative positions. Rooms: ${roomSummary}.`,
    `Wall constraints: keep exterior and interior partitions aligned to the provided ${walls.length} wall segments; do not invent extra rooms or remove labeled rooms.`,
    'Composition/framing: whole-home cutaway view, all rooms visible, similar camera angle to a model apartment floor-plan render.',
    'Materials/textures: warm wood flooring for living/bedrooms, tile for kitchen/bathroom/balcony, modern neutral furniture.',
    'Constraints: the render must resemble the source floor plan layout first; visual decoration is secondary.',
    'Avoid: changing room count, swapping kitchen/bathroom/bedroom locations, generic showroom layout, text labels, watermarks.'
  ].join('\n');
}

function furnitureForRoom(room = {}, index = 0) {
  const type = room.type || 'space';
  const id = room.id || `room-${index + 1}`;
  const furniture = {
    living: [
      { type: 'sofa', material: 'linen', position: { x: 0.28, y: 0, z: 0.36 }, size: { width: 2.4, depth: 0.9, height: 0.78 } },
      { type: 'coffee_table', material: 'wood', position: { x: 0.5, y: 0, z: 0.52 }, size: { width: 1.1, depth: 0.55, height: 0.38 } },
      { type: 'tv_console', material: 'wood', position: { x: 0.5, y: 0, z: 0.12 }, size: { width: 1.8, depth: 0.34, height: 0.48 } }
    ],
    bedroom: [
      { type: 'bed', material: 'linen', position: { x: 0.5, y: 0, z: 0.36 }, size: { width: 1.8, depth: 2.0, height: 0.58 } },
      { type: 'wardrobe', material: 'wood', position: { x: 0.12, y: 0, z: 0.5 }, size: { width: 0.6, depth: 1.8, height: 2.2 } },
      { type: 'nightstand', material: 'wood', position: { x: 0.74, y: 0, z: 0.18 }, size: { width: 0.45, depth: 0.45, height: 0.48 } }
    ],
    kitchen: [
      { type: 'base_cabinet', material: 'painted-wood', position: { x: 0.5, y: 0, z: 0.12 }, size: { width: 2.4, depth: 0.6, height: 0.9 } },
      { type: 'sink', material: 'steel', position: { x: 0.32, y: 0, z: 0.12 }, size: { width: 0.62, depth: 0.5, height: 0.18 } },
      { type: 'stove', material: 'black-glass', position: { x: 0.68, y: 0, z: 0.12 }, size: { width: 0.62, depth: 0.5, height: 0.12 } }
    ],
    bathroom: [
      { type: 'toilet', material: 'ceramic', position: { x: 0.22, y: 0, z: 0.28 }, size: { width: 0.42, depth: 0.72, height: 0.78 } },
      { type: 'vanity', material: 'ceramic', position: { x: 0.76, y: 0, z: 0.2 }, size: { width: 0.72, depth: 0.48, height: 0.86 } },
      { type: 'shower', material: 'glass', position: { x: 0.72, y: 0, z: 0.76 }, size: { width: 0.9, depth: 0.9, height: 2.1 } }
    ],
    dining: [
      { type: 'dining_table', material: 'wood', position: { x: 0.5, y: 0, z: 0.5 }, size: { width: 1.3, depth: 0.8, height: 0.76 } },
      { type: 'dining_chair_set', material: 'fabric', position: { x: 0.5, y: 0, z: 0.5 }, size: { width: 1.7, depth: 1.15, height: 0.9 } }
    ],
    entry: [
      { type: 'shoe_cabinet', material: 'wood', position: { x: 0.5, y: 0, z: 0.18 }, size: { width: 1.1, depth: 0.35, height: 1.05 } }
    ],
    balcony: [
      { type: 'laundry_cabinet', material: 'painted-wood', position: { x: 0.78, y: 0, z: 0.5 }, size: { width: 0.72, depth: 0.58, height: 1.9 } },
      { type: 'plant_stand', material: 'metal', position: { x: 0.26, y: 0, z: 0.55 }, size: { width: 0.48, depth: 0.48, height: 0.95 } }
    ],
    space: [
      { type: 'flex_storage', material: 'wood', position: { x: 0.5, y: 0, z: 0.5 }, size: { width: 0.9, depth: 0.45, height: 0.9 } }
    ]
  }[type] || [];

  return furniture.map((item, itemIndex) => ({
    id: `${id}-${item.type}-${itemIndex + 1}`,
    ...item
  }));
}

function normalizeOpening(opening = {}, index = 0) {
  const kind = opening.kind || opening.type || 'door';
  const position = opening.position || opening.center || {};
  const footprintWidth = Number(opening.width || opening.length || 0);
  const footprintHeight = Number(opening.height || 0);
  const wallOrientation = opening.orientation
    || opening.wallOrientation
    || opening.sourceEvidence?.wallOrientation
    || opening.sourceEvidence?.expectedWallOrientation
    || (footprintHeight > footprintWidth ? 'vertical' : 'horizontal');
  const span = Math.max(footprintWidth, footprintHeight, kind === 'door' ? 28 : 44);
  return {
    id: opening.id || `${kind}-${index + 1}`,
    kind,
    wallId: opening.wallId || opening.wall_id || opening.attachedWallId || opening.sourceEvidence?.attachedWallId || '',
    roomId: opening.roomId || opening.room_id || '',
    position: {
      x: Number(position.x ?? opening.x ?? 0),
      y: Number(position.y ?? opening.y ?? 0)
    },
    orientation: wallOrientation,
    width: Number(span.toFixed(1)),
    height: Number(opening.modelHeight || opening.openingHeight || (kind === 'door' ? 210 : 120)),
    sillHeight: Number(opening.sillHeight ?? (kind === 'door' ? 0 : 90)),
    sourceFootprint: {
      width: footprintWidth,
      height: footprintHeight,
      unit: 'image-pixel'
    },
    confidence: opening.confidence ?? null,
    reviewRequired: Boolean(opening.reviewRequired || opening.needsReview || opening.needsWallAttachmentReview)
  };
}

async function generateThreeDConfig(job, outputDir, rooms = []) {
  const parseResult = job?.floor_plan?.parse_result || {};
  const recognitionQuality = job?.runtimeHints?.recognitionDraft?.quality || {};
  const recognitionReadiness = recognitionQuality.commercialReadiness || {};
  const threeDReadiness = recognitionQuality.threeDReadiness || {};
  const renderStatus = threeDReadiness.status
    ? (threeDReadiness.status === 'ready_for_3d' ? 'ready_for_render' : threeDReadiness.status)
    : recognitionReadiness.status && recognitionReadiness.status !== 'commercial_ready'
      ? 'review_required'
      : 'ready_for_render';
  const recognitionWalls = job?.runtimeHints?.recognitionDraft?.walls || [];
  const allRecognitionOpenings = [
    ...(job?.runtimeHints?.recognitionDraft?.doors || []).map((opening) => ({ ...opening, kind: 'door' })),
    ...(job?.runtimeHints?.recognitionDraft?.windows || []).map((opening) => ({ ...opening, kind: 'window' }))
  ];
  const recognitionOpenings = allRecognitionOpenings.filter((opening) => (
    !opening.sourceEvidence?.needsVisualConfirmation
    && opening.source !== 'semantic-room-opening-prior'
  ));
  const proposedOpenings = allRecognitionOpenings.filter((opening) => (
    opening.sourceEvidence?.needsVisualConfirmation
    || opening.source === 'semantic-room-opening-prior'
  )).map(normalizeOpening);
  const fallbackOpenings = [
    ...(parseResult.doors || []).map((opening) => ({ ...opening, kind: 'door' })),
    ...(parseResult.windows || []).map((opening) => ({ ...opening, kind: 'window' }))
  ];
  const openings = (recognitionOpenings.length ? recognitionOpenings : fallbackOpenings).map(normalizeOpening);
  const walls = recognitionWalls.length ? recognitionWalls : (parseResult.walls || []);
  const style = job.job.input_payload?.style || 'modern-natural';
  const assemblyPlan = buildAssemblyPlan({ job, rooms, style });
  const structuralWallShells = buildStructuralWallShells(outputDir);
  const threeDConfig = {
    version: '0.1.0',
    jobNo: job.job.job_no,
    style,
    provider: config.renderProvider,
    target: 'decorated_3d_effect',
    renderStatus,
    recognitionReadiness,
    threeDReadiness,
    renderer: {
      provider: config.renderProvider,
      endpoint: config.renderEndpoint,
      commandConfigured: Boolean(config.renderCommand),
      imageGenerationPrompt: buildImageGenerationPrompt({ rooms, walls, style, recognitionReadiness }),
      commercialRenderSpec: {
        effectImage: {
          minWidth: 1600,
          minHeight: 1000,
          format: 'png-or-jpg',
          usage: '客户方案页、销售展示和内部审核'
        },
        birdseyeImage: {
          minWidth: 1600,
          minHeight: 1000,
          format: 'png-or-jpg',
          usage: '全屋俯瞰装修效果图，用于核对户型拓扑和家具布置'
        },
        interiorImage: {
          minWidth: 1600,
          minHeight: 1000,
          format: 'png-or-jpg',
          usage: '分房间室内观赏图，用于核对功能空间氛围和主要家具'
        },
        model: {
          preferredFormats: ['glb', 'blend'],
          mustInclude: ['room-shell', 'wall-partitions', 'floor-finishes', 'wall-finishes', 'lighting', 'major-furniture']
        },
        materialPolicy: '仅使用项目素材库、自有素材或明确可商用素材；外部素材必须保留 license/source 字段。'
      },
      acceptanceCriteria: [
        'threeDReadiness.status 必须为 ready_for_3d，才能把单图识别结果作为自动 3D 建模输入。',
        '若 recognitionReadiness.status 不是 commercial_ready，本配置只能作为复核草稿，不能作为最终准确装修图交付。',
        'layout-template 或 semantic prior 只能补充语义，不能替代图片中的墙体闭合证据。',
        '房间数量、名称和相对位置必须与 formal-plan.json 一致。',
        '厨房、卫生间、卧室、客餐厅不能互换位置。',
        '主要门窗洞口必须保留或在 review.md 标记为需复核。',
        '效果图不得出现水印、无授权品牌标识或与户型无关的额外空间。',
        '客户最终商用前需通过人工复核，并确认素材授权。'
      ],
      recommendedEngines: [
        {
          name: 'Sweet Home 3D',
          url: 'https://www.sweethome3d.com/',
          useCase: '成熟开源室内设计建模，可承接平面图到室内 3D 布置的人工/半自动工作流。'
        },
        {
          name: 'Blender / BlenderProc',
          url: 'https://github.com/DLR-RM/BlenderProc',
          useCase: '适合批量脚本化渲染室内效果图、全景图和数据集风格输出。'
        }
      ]
    },
    colors: {
      primary: '#c97342',
      accent: '#2f5d50',
      base: '#f4efe8'
    },
    materials: {
      floor: { texture: 'oak-wood', roughness: 0.42, color: '#c8a676' },
      wall: { texture: 'warm-paint', roughness: 0.68, color: '#f1ece5' },
      ceiling: { texture: 'matte-white', roughness: 0.88, color: '#faf9f7' }
    },
    coordinateSystem: {
      source: 'recognition-input-image-pixels',
      xAxis: 'image-right',
      yAxis: 'image-down',
      extrusionAxis: 'z-up',
      units: 'pixel-draft',
      scaleReviewRequired: true
    },
    structuralWallShells,
    openings,
    proposedOpenings,
    rooms: rooms.map((room, index) => ({
      id: room.id,
      name: room.name,
      type: room.type || 'space',
      area: room.area || 0,
      bounds: {
        x: room.x || 0,
        y: room.y || 0,
        width: room.width || 0,
        height: room.height || 0
      },
      furniture: furnitureForRoom(room, index),
      renderCamera: {
        id: `render-camera-${index + 1}`,
        name: `${room.name} 效果图机位`,
        position: { x: 1.2 + index * 0.35, y: 1.65, z: 2.4 + index * 0.22 },
        target: { x: 0, y: 1.1, z: 0 },
        lens: '24mm equivalent'
      }
    })),
    lighting: {
      ambient: { intensity: 0.65, color: '#fff4df' },
      point: [
        { id: 'light-1', position: { x: 2, y: 2.8, z: 2 }, intensity: 0.8 },
        { id: 'light-2', position: { x: 5, y: 2.6, z: 4 }, intensity: 0.65 }
      ]
    },
    deliverables: {
      sceneConfig: '3d-config.json',
      assemblyPlan: 'scene-assembly-plan.json',
      effectImages: [],
      birdseyeImages: [],
      interiorImages: [],
      modelFiles: [],
      structuralWallShellCount: structuralWallShells.length
    },
    assemblyPlanSummary: {
      sourceSkill: assemblyPlan.sourceSkill,
      assetLibrarySize: assemblyPlan.assetLibrarySize,
      roomPlanCount: assemblyPlan.roomPlans.length,
      missingAssets: assemblyPlan.missingAssets
    },
    assemblyPlan: {
      sourceSkill: assemblyPlan.sourceSkill,
      roomPlans: assemblyPlan.roomPlans.slice(0, 6)
    }
  };

  fs.writeFileSync(path.join(outputDir, 'scene-assembly-plan.json'), JSON.stringify(assemblyPlan, null, 2), 'utf8');

  const localEffectImage = generateEffectRender({
    outputDir,
    rooms,
    walls,
    openings: recognitionOpenings,
    colors: threeDConfig.colors,
    materials: threeDConfig.materials
  });
  const localBirdseyeImage = generateBirdseyeRender({
    outputDir,
    rooms,
    walls,
    openings: recognitionOpenings,
    colors: threeDConfig.colors,
    materials: threeDConfig.materials
  });
  const localInteriorImages = generateInteriorViews({
    outputDir,
    rooms,
    openings: recognitionOpenings,
    colors: threeDConfig.colors,
    materials: threeDConfig.materials
  });
  threeDConfig.deliverables.effectImages.push(localEffectImage);
  threeDConfig.deliverables.birdseyeImages.push(localBirdseyeImage, 'birdseye-render.svg');
  threeDConfig.deliverables.interiorImages.push(...localInteriorImages);
  const filePath = path.join(outputDir, '3d-config.json');
  fs.writeFileSync(filePath, JSON.stringify(threeDConfig, null, 2), 'utf8');

  if (config.renderCommand) {
    try {
      const result = await runExternalRenderer(
        config.renderCommand,
        [
          '--job', path.resolve(outputDir, 'job-context.json'),
          '--scene', path.join(outputDir, '3d-config.json'),
          '--assembly-plan', path.join(outputDir, 'scene-assembly-plan.json'),
          '--output', outputDir
        ],
        config.renderTimeoutMs,
        outputDir,
        {
          CODEX_RENDER_PROVIDER: config.renderProvider,
          CODEX_RENDER_ENDPOINT: config.renderEndpoint,
          CODEX_RENDER_API_KEY: config.renderApiKey
        }
      );
      const output = normalizeOutput(result?.output || result, outputDir);
      threeDConfig.deliverables.effectImages = uniqueList([
        ...threeDConfig.deliverables.effectImages,
        output.effectImage,
        output.renderImage,
        output.previewImage,
        output.birdseyeImage
      ]);
      threeDConfig.deliverables.birdseyeImages = uniqueList([
        ...threeDConfig.deliverables.birdseyeImages,
        output.birdseyeImage,
        output.effectImage,
        output.renderImage
      ]);
      threeDConfig.deliverables.interiorImages = uniqueList([
        ...threeDConfig.deliverables.interiorImages,
        ...(Array.isArray(output.interiorImages) ? output.interiorImages : []),
        output.interiorImage
      ]);
      threeDConfig.deliverables.modelFiles = uniqueList([output.modelFile, output.glbFile, output.blendFile]);
      threeDConfig.renderer.externalResult = result?.summary || null;
    } catch (error) {
      threeDConfig.renderer.externalError = error.message;
      try {
        const fallback = runRasterFallback(outputDir, { scene: true });
        const output = fallback.output || {};
        threeDConfig.deliverables.effectImages = uniqueList([
          ...threeDConfig.deliverables.effectImages,
          output.effectImage,
          output.renderImage,
          output.previewImage,
          output.birdseyeImage
        ]);
        threeDConfig.deliverables.birdseyeImages = uniqueList([
          ...threeDConfig.deliverables.birdseyeImages,
          output.birdseyeImage,
          output.effectImage,
          output.renderImage
        ]);
        threeDConfig.deliverables.interiorImages = uniqueList([
          ...threeDConfig.deliverables.interiorImages,
          ...(Array.isArray(output.interiorImages) ? output.interiorImages : []),
          output.interiorImage
        ]);
        threeDConfig.renderer.fallbackResult = fallback.summary || null;
      } catch (fallbackError) {
        threeDConfig.renderer.fallbackError = fallbackError.message;
      }
    }

    fs.writeFileSync(filePath, JSON.stringify(threeDConfig, null, 2), 'utf8');
  }

  return filePath;
}

module.exports = {
  generateThreeDConfig
};
