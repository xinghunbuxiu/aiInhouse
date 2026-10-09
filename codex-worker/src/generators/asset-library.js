const fs = require('fs');
const path = require('path');

const assetFile = path.resolve(__dirname, '..', '..', '..', 'backend', 'data', 'design-assets.json');

function readDesignAssets() {
  if (!fs.existsSync(assetFile)) {
    return [];
  }

  try {
    return JSON.parse(fs.readFileSync(assetFile, 'utf8'));
  } catch (error) {
    return [];
  }
}

function normalizeStyleTokens(style = '') {
  const raw = String(style || '').toLowerCase();
  const tokens = new Set(raw.split(/[^a-z0-9\u4e00-\u9fa5]+/).filter(Boolean));
  const aliasMap = {
    'modern-natural': ['现代简约', '现代自然', '原木风'],
    modern: ['现代简约', '现代自然'],
    minimal: ['现代简约', '极简'],
    cream: ['奶油风', '法式奶油'],
    luxury: ['轻奢', '现代轻奢'],
    chinese: ['新中式', '中式'],
    'new-chinese': ['新中式'],
    nordic: ['北欧', '原木风'],
    japanese: ['日式原木', '原木风'],
    wabi: ['侘寂', '日式原木'],
    industrial: ['工业风']
  };
  for (const [key, values] of Object.entries(aliasMap)) {
    if (raw.includes(key)) {
      values.forEach((value) => tokens.add(value));
    }
  }
  if (!tokens.size) {
    tokens.add('现代简约');
  }
  return tokens;
}

function assetScore(asset, style = '') {
  let score = Number(asset?.properties?.priority || 0);
  const styleTokens = normalizeStyleTokens(style);
  const assetStyles = new Set([...(asset?.styleTags || []), ...(asset?.tags || [])]);
  for (const token of styleTokens) {
    if (assetStyles.has(token)) {
      score += 70;
    }
  }
  if (asset?.domesticTags?.length) {
    score += 8;
  }
  if (asset?.modelUrl) {
    score += 40;
  }
  if (asset?.textureUrl) {
    score += 30;
  }
  if (asset?.pbrTextures?.baseColor) {
    score += 14;
  }
  if (asset?.pbrTextures?.roughness) {
    score += 6;
  }
  if (asset?.sourceType === 'polyhaven_cc0') {
    score += 25;
  }
  if (asset?.sourceType === 'procedural_glb') {
    score += 18;
  }
  if (asset?.sourceType === 'procedural') {
    score += 5;
  }
  return score;
}

function styleMatches(asset, style = '') {
  const styleTokens = normalizeStyleTokens(style);
  const assetStyles = new Set([...(asset?.styleTags || []), ...(asset?.tags || [])]);
  return [...styleTokens].some((token) => assetStyles.has(token));
}

function styleCompatible(asset, style = '') {
  const raw = String(style || '').toLowerCase();
  const isSpecificStyle = ['cream', 'luxury', 'chinese', 'new-chinese', 'industrial', '奶油', '轻奢', '中式', '工业'].some((token) => raw.includes(token));
  if (!isSpecificStyle) {
    return true;
  }
  if (styleMatches(asset, style)) {
    return true;
  }
  const styles = asset?.styleTags || [];
  return styles.length === 0 || styles.some((styleTag) => ['现代简约', '现代自然'].includes(styleTag));
}

function sortAssets(assets = [], style = '') {
  return [...assets].sort((a, b) => assetScore(b, style) - assetScore(a, style));
}

function selectAsset(assets, category, roomType, fallbackScene = 'space', style = '') {
  const sorted = sortAssets(assets, style);
  const compatible = sorted.filter((asset) => styleCompatible(asset, style));
  const pickFrom = (pool) => pool.find((asset) => asset.category === category && asset.sceneTypes?.includes(roomType))
    || pool.find((asset) => asset.category === category && asset.sceneTypes?.includes(fallbackScene))
    || pool.find((asset) => asset.category === category)
    || null;

  return pickFrom(compatible) || pickFrom(sorted);
}

function selectAssets(assets, category, roomType, fallbackScene = 'space', limit = 2, style = '') {
  const selected = [];
  const add = (asset) => {
    if (asset?.id && !selected.some((item) => item.id === asset.id)) {
      selected.push(asset);
    }
  };

  const addFrom = (pool) => {
    pool
      .filter((asset) => asset.category === category && asset.sceneTypes?.includes(roomType))
      .forEach(add);
    pool
      .filter((asset) => asset.category === category && asset.sceneTypes?.includes(fallbackScene))
      .forEach(add);
    pool
      .filter((asset) => asset.category === category)
      .forEach(add);
  };

  addFrom(sortAssets(assets, style).filter((asset) => styleCompatible(asset, style)));
  if (selected.length < limit) {
    addFrom(sortAssets(assets, style));
  }

  return selected.slice(0, limit);
}

function selectAppliances(assets, roomType, style = '') {
  const limit = roomType === 'kitchen' ? 3 : 2;
  const selected = [];
  const seenRoles = new Set();
  const add = (asset) => {
    if (!asset?.id || selected.some((item) => item.id === asset.id)) {
      return;
    }
    const role = asset.properties?.role || asset.properties?.blenderPrimitive || asset.id;
    if (seenRoles.has(role)) {
      return;
    }
    seenRoles.add(role);
    selected.push(asset);
  };
  const addFrom = (pool) => {
    pool
      .filter((asset) => asset.category === 'appliance' && asset.sceneTypes?.includes(roomType))
      .forEach(add);
  };

  addFrom(sortAssets(assets, style).filter((asset) => styleCompatible(asset, style)));
  if (selected.length < limit) {
    addFrom(sortAssets(assets, style));
  }
  return selected.slice(0, limit);
}

function selectAssetLegacy(assets, category, roomType, fallbackScene = 'space', style = '') {
  const sorted = sortAssets(assets, style);
  return sorted.find((asset) => asset.category === category && asset.sceneTypes?.includes(roomType))
    || sorted.find((asset) => asset.category === category && asset.sceneTypes?.includes(fallbackScene))
    || sorted.find((asset) => asset.category === category)
    || null;
}

function selectAssetsLegacy(assets, category, roomType, fallbackScene = 'space', limit = 2, style = '') {
  const selected = [];
  const add = (asset) => {
    if (asset?.id && !selected.some((item) => item.id === asset.id)) {
      selected.push(asset);
    }
  };

  sortAssets(assets, style)
    .filter((asset) => asset.category === category && asset.sceneTypes?.includes(roomType))
    .forEach(add);
  sortAssets(assets, style)
    .filter((asset) => asset.category === category && asset.sceneTypes?.includes(fallbackScene))
    .forEach(add);
  sortAssets(assets, style)
    .filter((asset) => asset.category === category)
    .forEach(add);

  return selected.slice(0, limit);
}

function roleMatchesRoom(asset, roomType) {
  const role = asset?.properties?.role || '';
  const primitive = asset?.properties?.blenderPrimitive || '';
  if (roomType === 'living') {
    return role === 'primary_seating' || primitive === 'sofa';
  }
  if (roomType === 'dining') {
    return ['dining_table'].includes(role) || primitive === 'dining-table';
  }
  if (roomType === 'bedroom') {
    return ['bed'].includes(role) || primitive === 'bed';
  }
  if (roomType === 'kitchen') {
    return primitive === 'kitchen-cabinet';
  }
  if (roomType === 'bathroom') {
    return primitive === 'bathroom-vanity';
  }
  return true;
}

function selectMainFurniture(assets, roomType, style = '') {
  if (['kitchen', 'bathroom', 'balcony'].includes(roomType)) {
    return null;
  }

  const sorted = sortAssets(assets, style);
  const compatible = sorted.filter((asset) => styleCompatible(asset, style));
  const candidates = compatible
    .filter((asset) => asset.category === 'furniture' && asset.sceneTypes?.includes(roomType));
  const fallbackCandidates = sorted
    .filter((asset) => asset.category === 'furniture' && asset.sceneTypes?.includes(roomType));
  return candidates.find((asset) => roleMatchesRoom(asset, roomType))
    || candidates.find((asset) => !['nightstand', 'accent_chair', 'dining_chair'].includes(asset?.properties?.role || ''))
    || fallbackCandidates.find((asset) => roleMatchesRoom(asset, roomType))
    || fallbackCandidates.find((asset) => !['nightstand', 'accent_chair', 'dining_chair'].includes(asset?.properties?.role || ''))
    || null;
}

function selectSupportingFurniture(assets, roomType, excludeIds = [], style = '') {
  const roleByRoom = {
    living: ['console', 'coffee_table', 'accent_chair'],
    dining: ['dining_chair'],
    bedroom: ['nightstand', 'accent_chair'],
    entry: ['console']
  };
  const roles = roleByRoom[roomType] || [];
  if (!roles.length) {
    return [];
  }

  const sorted = sortAssets(assets, style);
  const selected = sorted
    .filter((asset) => styleCompatible(asset, style))
    .filter((asset) => asset.category === 'furniture' && asset.sceneTypes?.includes(roomType))
    .filter((asset) => roles.includes(asset?.properties?.role || ''))
    .filter((asset) => !excludeIds.includes(asset.id))
    .slice(0, ['living', 'dining'].includes(roomType) ? 2 : 1);
  if (selected.length) {
    return selected;
  }
  return sorted
    .filter((asset) => asset.category === 'furniture' && asset.sceneTypes?.includes(roomType))
    .filter((asset) => roles.includes(asset?.properties?.role || ''))
    .filter((asset) => !excludeIds.includes(asset.id))
    .slice(0, ['living', 'dining'].includes(roomType) ? 2 : 1);
}

function compactAsset(asset) {
  if (!asset) {
    return null;
  }

  return {
    id: asset.id,
    name: asset.name,
    category: asset.category,
    placement: asset.placement,
    aiDescription: asset.aiDescription,
    properties: asset.properties || {},
    assetUrl: asset.assetUrl || '',
    modelUrl: asset.modelUrl || '',
    textureUrl: asset.textureUrl || '',
    pbrTextures: asset.pbrTextures || {},
    styleTags: asset.styleTags || [],
    domesticTags: asset.domesticTags || [],
    previewUrl: asset.previewUrl || '',
    sourceType: asset.sourceType || 'manual',
    sourceUrl: asset.sourceUrl || '',
    license: asset.license || ''
  };
}

function collectRendererAssets(roomPlans = []) {
  const seen = new Map();
  for (const roomPlan of roomPlans) {
    for (const step of roomPlan.steps || []) {
      if (!step.asset?.id) {
        continue;
      }
      seen.set(step.asset.id, {
        id: step.asset.id,
        name: step.asset.name,
        category: step.asset.category,
        placement: step.asset.placement,
        modelUrl: step.asset.modelUrl || step.asset.assetUrl || '',
        textureUrl: step.asset.textureUrl || '',
        pbrTextures: step.asset.pbrTextures || {},
        styleTags: step.asset.styleTags || [],
        domesticTags: step.asset.domesticTags || [],
        previewUrl: step.asset.previewUrl || '',
        properties: step.asset.properties || {},
        sourceType: step.asset.sourceType || 'manual',
        sourceUrl: step.asset.sourceUrl || '',
        license: step.asset.license || ''
      });
    }
  }
  return [...seen.values()];
}

function buildAssemblyPlan({ job, rooms = [], style = 'modern-natural' }) {
  const assets = readDesignAssets();
  const missingAssets = [];

  const roomPlans = rooms.map((room, index) => {
    const roomType = room.type || 'space';
    const floorCategory = ['kitchen', 'bathroom'].includes(roomType) ? 'floor_finish' : 'floor_finish';
    const wall = selectAsset(assets, 'wall_finish', roomType, 'space', style);
    const floor = selectAsset(assets, floorCategory, roomType, 'space', style);
    const ceiling = selectAsset(assets, 'ceiling_finish', roomType, 'space', style);
    const lighting = selectAsset(assets, 'lighting', roomType, 'space', style);
    const cabinet = selectAsset(assets, 'cabinet', roomType, 'space', style);
    const furniture = selectMainFurniture(assets, roomType, style);
    const supportingFurniture = selectSupportingFurniture(assets, roomType, [furniture?.id].filter(Boolean), style);
    const softDecor = selectAssets(assets, 'soft_decor', roomType, 'space', roomType === 'living' ? 2 : 1, style);
    const appliances = ['kitchen', 'bathroom', 'balcony'].includes(roomType)
      ? selectAppliances(assets, roomType, style)
      : [];
    const sanitary = roomType === 'bathroom' ? selectAssets(assets, 'sanitary', roomType, 'bathroom', 3, style) : [];
    const openings = selectAssets(assets, 'opening', roomType, 'space', 2, style);

    for (const [key, asset] of Object.entries({ wall, floor, ceiling, lighting })) {
      if (!asset) {
        missingAssets.push({ roomId: room.id || `room-${index + 1}`, category: key });
      }
    }

    const steps = [
      {
        id: 'build-shell',
        name: '建立墙体和房间边界',
        action: 'construct_room_shell',
        asset: null,
        instruction: '根据平面图外墙和内隔断建立房屋结构，保留门窗开口。'
      },
      {
        id: 'paint-wall',
        name: '刷墙',
        action: 'apply_wall_finish',
        asset: compactAsset(wall),
        instruction: wall?.usage || '为室内墙面应用基础墙面材质。'
      },
      {
        id: 'lay-floor',
        name: ['kitchen', 'bathroom'].includes(roomType) ? '铺防滑瓷砖' : '铺地板',
        action: 'apply_floor_finish',
        asset: compactAsset(floor),
        instruction: floor?.usage || '根据空间类型应用地面材质。'
      },
      {
        id: 'install-ceiling',
        name: '吊顶/天花',
        action: 'apply_ceiling_finish',
        asset: compactAsset(ceiling),
        instruction: ceiling?.usage || '建立天花材质和基础灯位。'
      },
      {
        id: 'install-lighting',
        name: '灯光布置',
        action: 'place_lighting',
        asset: compactAsset(lighting),
        instruction: lighting?.usage || '根据房间动线和功能区布置基础照明。'
      }
    ];

    if (cabinet && ['kitchen', 'bathroom', 'bedroom', 'entry', 'hallway', 'balcony'].includes(roomType)) {
      steps.push({
        id: 'install-cabinet',
        name: '柜体/收纳',
        action: 'place_cabinet',
        asset: compactAsset(cabinet),
        instruction: cabinet.usage
      });
    }

    if (furniture) {
      steps.push({
        id: 'place-furniture',
        name: '家具软装',
        action: 'place_furniture',
        asset: compactAsset(furniture),
        instruction: furniture.usage
      });
    }

    supportingFurniture.forEach((asset, assetIndex) => {
      steps.push({
        id: `place-supporting-furniture-${assetIndex + 1}`,
        name: `辅助家具/${asset.name}`,
        action: 'place_supporting_furniture',
        asset: compactAsset(asset),
        instruction: asset.usage
      });
    });

    softDecor.forEach((asset, assetIndex) => {
      steps.push({
        id: `place-soft-decor-${assetIndex + 1}`,
        name: `软装/${asset.name}`,
        action: 'place_soft_decor',
        asset: compactAsset(asset),
        instruction: asset.usage
      });
    });

    appliances.forEach((asset, assetIndex) => {
      steps.push({
        id: `place-appliance-${assetIndex + 1}`,
        name: `电器/${asset.name}`,
        action: 'place_appliance',
        asset: compactAsset(asset),
        instruction: asset.usage
      });
    });

    sanitary.forEach((asset, assetIndex) => {
      steps.push({
        id: `place-sanitary-${assetIndex + 1}`,
        name: `洁具/${asset.name}`,
        action: 'place_sanitary',
        asset: compactAsset(asset),
        instruction: asset.usage
      });
    });

    openings.forEach((asset, assetIndex) => {
      steps.push({
        id: `place-opening-${assetIndex + 1}`,
        name: `门窗/${asset.name}`,
        action: 'place_opening_asset',
        asset: compactAsset(asset),
        instruction: asset.usage
      });
    });

    return {
      roomId: room.id || `room-${index + 1}`,
      roomName: room.name || `空间 ${index + 1}`,
      roomType,
      area: room.area || 0,
      steps
    };
  });

  const plan = {
    version: '0.1.0',
    jobNo: job?.job?.job_no || '',
    style,
    purpose: '把平面图识别结果按装修工序和素材语义装配为可渲染场景。',
    sourceSkill: 'docs/renovation-generation-skill.md',
    assetLibrarySize: assets.length,
    roomPlans,
    missingAssets,
    rendererContract: {
      effectImage: 'renderer should output normal interior render image',
      panoramaImage: 'renderer should output 2:1 equirectangular image for VR viewer',
      modelFile: 'optional GLB/Blend scene with room shell, finishes, furniture and lighting'
    }
  };

  plan.rendererAssets = collectRendererAssets(roomPlans);
  return plan;
}

module.exports = {
  buildAssemblyPlan,
  readDesignAssets
};
