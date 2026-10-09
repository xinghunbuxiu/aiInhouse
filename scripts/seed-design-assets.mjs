import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataFile = path.join(root, 'backend', 'data', 'design-assets.json');
const generatedDir = path.join(root, 'backend', 'uploads', 'design-assets', 'generated');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function slug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function readExistingAssets() {
  if (!fs.existsSync(dataFile)) {
    return [];
  }

  try {
    return JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  } catch (_) {
    return [];
  }
}

function previewSvg(asset) {
  const color = asset.properties?.color || '#cbd5e1';
  const secondary = asset.properties?.secondaryColor || asset.properties?.accentColor || '#475569';
  const title = asset.name || asset.id;
  const category = asset.category || '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#f8fafc"/>
      <stop offset="1" stop-color="#e5e7eb"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#0f172a" flood-opacity="0.18"/>
    </filter>
  </defs>
  <rect width="640" height="420" rx="0" fill="url(#bg)"/>
  <g filter="url(#shadow)">
    <rect x="130" y="90" width="380" height="220" rx="28" fill="${color}"/>
    <rect x="178" y="136" width="284" height="128" rx="18" fill="${secondary}" opacity="0.72"/>
    <circle cx="230" cy="318" r="18" fill="#111827" opacity="0.72"/>
    <circle cx="410" cy="318" r="18" fill="#111827" opacity="0.72"/>
  </g>
  <text x="320" y="360" text-anchor="middle" font-family="Arial, sans-serif" font-size="28" font-weight="700" fill="#0f172a">${title}</text>
  <text x="320" y="388" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" fill="#64748b">${category}</text>
</svg>`;
}

function makeAsset({
  id,
  name,
  category,
  usage,
  sceneTypes,
  placement,
  aiDescription,
  tags,
  properties,
  license = 'Project-owned procedural placeholder; generated geometry/material only.',
  sourceType = 'procedural',
  sourceUrl = '',
  modelUrl = '',
  textureUrl = '',
  priority = 50
}) {
  const safeId = slug(id || name);
  return {
    id: safeId,
    name,
    category,
    usage,
    sceneTypes,
    placement,
    aiDescription,
    tags,
    properties: {
      ...(properties || {}),
      priority
    },
    assetUrl: '',
    modelUrl,
    textureUrl,
    previewUrl: `/uploads/design-assets/generated/${safeId}.svg`,
    sourceType,
    sourceUrl,
    license,
    updatedAt: new Date().toISOString()
  };
}

const proceduralAssets = [
  makeAsset({
    id: 'wall-warm-paint',
    name: '暖白乳胶漆墙面',
    category: 'wall_finish',
    usage: '用于客厅、卧室、餐厅等主要墙面，作为大面积基础墙色。',
    sceneTypes: ['living', 'bedroom', 'dining', 'space', 'entry', 'hallway'],
    placement: 'apply_to_all_interior_walls',
    aiDescription: 'Warm white matte painted wall finish for modern natural interior walls.',
    tags: ['刷墙', '墙面', '基础硬装', '现代自然'],
    properties: { color: '#f1ece5', roughness: 0.68, texture: 'warm-paint', blenderPrimitive: 'material-wall' },
    priority: 90
  }),
  makeAsset({
    id: 'wall-greige-accent',
    name: '灰米色背景墙',
    category: 'wall_finish',
    usage: '用于客厅电视墙、卧室床头背景或餐厅局部强调墙。',
    sceneTypes: ['living', 'bedroom', 'dining'],
    placement: 'apply_to_feature_wall',
    aiDescription: 'Greige accent wall for a calm modern interior feature surface.',
    tags: ['背景墙', '墙面', '灰米色'],
    properties: { color: '#d8d0c2', roughness: 0.72, texture: 'greige-paint', blenderPrimitive: 'material-wall' },
    priority: 65
  }),
  makeAsset({
    id: 'wall-new-chinese-walnut-lattice',
    name: '新中式胡桃木格栅背景墙',
    category: 'wall_finish',
    usage: '用于客厅电视墙、玄关端景或卧室床头背景，形成新中式重点立面。',
    sceneTypes: ['living', 'bedroom', 'entry', 'dining'],
    placement: 'apply_to_feature_wall',
    aiDescription: 'New Chinese walnut wood lattice feature wall with calm vertical rhythm.',
    tags: ['新中式', '背景墙', '胡桃木', '木格栅', '端景'],
    properties: { color: '#5b3824', secondaryColor: '#d7c7ae', roughness: 0.48, texture: 'walnut-lattice', blenderPrimitive: 'material-wall' },
    priority: 96
  }),
  makeAsset({
    id: 'wall-industrial-cement',
    name: '工业风水泥墙面',
    category: 'wall_finish',
    usage: '用于客厅、餐厅、书房或开放空间背景墙，营造粗粝水泥质感。',
    sceneTypes: ['living', 'dining', 'space', 'entry'],
    placement: 'apply_to_feature_wall',
    aiDescription: 'Industrial style raw cement feature wall with matte concrete texture.',
    tags: ['工业风', '水泥', '背景墙', '粗粝', '灰色'],
    properties: { color: '#77716a', secondaryColor: '#3f3f3f', roughness: 0.86, texture: 'raw-cement', blenderPrimitive: 'material-wall' },
    priority: 98
  }),
  makeAsset({
    id: 'wall-cream-arched-panel',
    name: '奶油风弧形护墙板',
    category: 'wall_finish',
    usage: '用于客厅沙发墙、卧室床头或餐厅局部墙面，适合国内常见奶油风改造。',
    sceneTypes: ['living', 'bedroom', 'dining', 'entry'],
    placement: 'apply_to_feature_wall',
    aiDescription: 'Cream style arched wall panel feature in warm ivory finish.',
    tags: ['奶油风', '弧形', '护墙板', '暖白', '背景墙'],
    properties: { color: '#eee4d3', secondaryColor: '#cdbf9f', roughness: 0.7, texture: 'cream-arched-panel', blenderPrimitive: 'material-wall' },
    priority: 90
  }),
  makeAsset({
    id: 'wall-light-luxury-stone-metal',
    name: '轻奢石材金属背景墙',
    category: 'wall_finish',
    usage: '用于客厅电视墙或玄关背景，表达石材纹理和细金属线条。',
    sceneTypes: ['living', 'entry', 'dining'],
    placement: 'apply_to_feature_wall',
    aiDescription: 'Modern light luxury stone feature wall with slim champagne metal trims.',
    tags: ['轻奢', '现代轻奢', '石材', '金属线条', '背景墙'],
    properties: { color: '#d8d0c2', secondaryColor: '#b68b3f', roughness: 0.38, metallic: 0.35, texture: 'stone-metal-trim', blenderPrimitive: 'material-wall' },
    priority: 88
  }),
  makeAsset({
    id: 'floor-oak-wood',
    name: '橡木木地板',
    category: 'floor_finish',
    usage: '用于客厅、卧室、餐厅地面，建立温暖自然的家居基底。',
    sceneTypes: ['living', 'bedroom', 'dining', 'space', 'entry'],
    placement: 'apply_to_room_floor',
    aiDescription: 'Warm oak wood floor planks for living rooms, bedrooms and dining rooms.',
    tags: ['铺地板', '地面', '木地板', '温暖'],
    properties: { color: '#c8a676', secondaryColor: '#8b6334', roughness: 0.42, texture: 'oak-wood', blenderPrimitive: 'material-floor' },
    priority: 90
  }),
  makeAsset({
    id: 'floor-walnut-herringbone',
    name: '胡桃木人字拼地板',
    category: 'floor_finish',
    usage: '用于新中式客厅、卧室和餐厅地面，强化温润深木色秩序感。',
    sceneTypes: ['living', 'bedroom', 'dining', 'space'],
    placement: 'apply_to_room_floor',
    aiDescription: 'Dark walnut herringbone floor for new Chinese residential interiors.',
    tags: ['新中式', '胡桃木', '人字拼', '木地板', '深木色'],
    properties: { color: '#6c4228', secondaryColor: '#2f2118', roughness: 0.44, texture: 'walnut-herringbone', blenderPrimitive: 'material-floor' },
    priority: 94
  }),
  makeAsset({
    id: 'floor-industrial-concrete',
    name: '工业风微水泥地面',
    category: 'floor_finish',
    usage: '用于工业风客餐厅、玄关和开放空间地面，保持连续灰色基底。',
    sceneTypes: ['living', 'dining', 'space', 'entry', 'hallway'],
    placement: 'apply_to_room_floor',
    aiDescription: 'Industrial microcement concrete floor with subtle mottled gray surface.',
    tags: ['工业风', '微水泥', '水泥地面', '灰色', '开放空间'],
    properties: { color: '#68645e', secondaryColor: '#3b3b3b', roughness: 0.82, texture: 'microcement', blenderPrimitive: 'material-floor' },
    priority: 96
  }),
  makeAsset({
    id: 'floor-cream-terrazzo',
    name: '奶油风浅色水磨石地砖',
    category: 'floor_finish',
    usage: '用于奶油风客餐厅、玄关、厨房和阳台，形成耐用的浅色整体地面。',
    sceneTypes: ['living', 'dining', 'kitchen', 'balcony', 'entry', 'space'],
    placement: 'apply_to_room_floor',
    aiDescription: 'Light cream terrazzo tile for Chinese residential cream style interiors.',
    tags: ['奶油风', '水磨石', '浅色地砖', '玄关', '厨房'],
    properties: { color: '#e6ddcb', secondaryColor: '#b8aa91', roughness: 0.55, texture: 'cream-terrazzo', blenderPrimitive: 'material-floor' },
    priority: 87
  }),
  makeAsset({
    id: 'floor-light-stone-tile',
    name: '浅米石纹地砖',
    category: 'floor_finish',
    usage: '用于玄关、厨房、阳台或需要更耐磨清洁的公共区域。',
    sceneTypes: ['kitchen', 'bathroom', 'balcony', 'entry', 'hallway'],
    placement: 'apply_to_room_floor',
    aiDescription: 'Light beige stone-look tile for durable wet or transition spaces.',
    tags: ['地砖', '石纹', '厨房', '阳台'],
    properties: { color: '#d9d2c3', secondaryColor: '#a8a29e', roughness: 0.58, texture: 'stone-tile', blenderPrimitive: 'material-floor' },
    priority: 84
  }),
  makeAsset({
    id: 'bathroom-ceramic-tile',
    name: '浅灰防滑瓷砖',
    category: 'floor_finish',
    usage: '用于卫生间和厨房地面，强调防水、防滑和易清洁。',
    sceneTypes: ['bathroom', 'kitchen'],
    placement: 'apply_to_wet_room_floor',
    aiDescription: 'Light gray anti-slip ceramic tile for bathroom and kitchen floors.',
    tags: ['瓷砖', '卫生间', '厨房', '防滑'],
    properties: { color: '#d1d5db', secondaryColor: '#94a3b8', roughness: 0.76, texture: 'ceramic-tile', blenderPrimitive: 'material-floor' },
    priority: 95
  }),
  makeAsset({
    id: 'ceiling-matte-white',
    name: '哑光白平顶',
    category: 'ceiling_finish',
    usage: '用于全屋基础吊顶或平顶，适合无复杂造型的现代简约空间。',
    sceneTypes: ['living', 'bedroom', 'kitchen', 'bathroom', 'dining', 'space', 'entry', 'hallway'],
    placement: 'apply_to_room_ceiling',
    aiDescription: 'Matte white ceiling finish with simple modern flat surface.',
    tags: ['吊顶', '天花', '基础硬装'],
    properties: { color: '#faf9f7', roughness: 0.88, texture: 'matte-white', blenderPrimitive: 'material-ceiling' },
    priority: 90
  }),
  makeAsset({
    id: 'ceiling-new-chinese-wood-trim',
    name: '新中式木线条平顶',
    category: 'ceiling_finish',
    usage: '用于新中式客餐厅、卧室和玄关天花，以深木线条形成简洁层次。',
    sceneTypes: ['living', 'bedroom', 'dining', 'entry', 'space'],
    placement: 'apply_to_room_ceiling',
    aiDescription: 'New Chinese flat ceiling with subtle walnut trim lines.',
    tags: ['新中式', '吊顶', '天花', '木线条', '胡桃木'],
    properties: { color: '#f3eee5', secondaryColor: '#5b3824', roughness: 0.72, texture: 'wood-trim-ceiling', blenderPrimitive: 'material-ceiling' },
    priority: 90
  }),
  makeAsset({
    id: 'ceiling-industrial-exposed',
    name: '工业风裸顶灰色天花',
    category: 'ceiling_finish',
    usage: '用于工业风客餐厅、走廊和开放空间，表现裸顶与管线感。',
    sceneTypes: ['living', 'dining', 'entry', 'hallway', 'space'],
    placement: 'apply_to_room_ceiling',
    aiDescription: 'Industrial exposed gray ceiling finish for raw loft-like spaces.',
    tags: ['工业风', '裸顶', '灰色天花', '水泥', '管线'],
    properties: { color: '#66615a', secondaryColor: '#232323', roughness: 0.88, texture: 'industrial-exposed-ceiling', blenderPrimitive: 'material-ceiling' },
    priority: 92
  }),
  makeAsset({
    id: 'ceiling-light-luxury-groove',
    name: '轻奢金属凹槽吊顶',
    category: 'ceiling_finish',
    usage: '用于现代轻奢客厅、餐厅和卧室，搭配线性灯和金属线条。',
    sceneTypes: ['living', 'dining', 'bedroom', 'entry', 'space'],
    placement: 'apply_to_room_ceiling',
    aiDescription: 'Light luxury ceiling with champagne groove trim and warm white plane.',
    tags: ['轻奢', '现代轻奢', '吊顶', '金属线条', '线性灯'],
    properties: { color: '#f4efe6', secondaryColor: '#b68b3f', roughness: 0.58, texture: 'luxury-groove-ceiling', blenderPrimitive: 'material-ceiling' },
    priority: 92
  }),
  makeAsset({
    id: 'linear-downlight',
    name: '线性筒灯',
    category: 'lighting',
    usage: '用于客厅、走廊、卧室基础照明，沿墙或动线布置。',
    sceneTypes: ['living', 'bedroom', 'dining', 'space', 'entry', 'hallway'],
    placement: 'place_on_ceiling_grid',
    aiDescription: 'Warm linear downlights distributed along circulation and furniture zones.',
    tags: ['灯光', '筒灯', '吊顶', '照明'],
    properties: { color: '#fff4df', intensity: 0.8, temperature: 'warm', blenderPrimitive: 'area-light' },
    priority: 88
  }),
  makeAsset({
    id: 'pendant-dining-warm',
    name: '餐厅暖光吊灯',
    category: 'lighting',
    usage: '用于餐桌上方，形成餐厅视觉中心和局部暖光。',
    sceneTypes: ['dining', 'living'],
    placement: 'hang_above_dining_table',
    aiDescription: 'Warm pendant lamp above dining table, modern soft residential lighting.',
    tags: ['吊灯', '餐厅', '暖光'],
    properties: { color: '#facc15', intensity: 1.1, temperature: 'warm', blenderPrimitive: 'pendant-light' },
    priority: 75
  }),
  makeAsset({
    id: 'pendant-new-chinese-lantern',
    name: '新中式纸灯笼吊灯',
    category: 'lighting',
    usage: '用于餐桌、茶区或玄关端景上方，提供柔和暖光和东方意向。',
    sceneTypes: ['dining', 'living', 'entry'],
    placement: 'hang_above_dining_table',
    aiDescription: 'Warm new Chinese lantern pendant light above dining or tea area.',
    tags: ['新中式', '吊灯', '纸灯笼', '暖光', '餐厅'],
    properties: { color: '#f6dfb2', secondaryColor: '#4a2f21', intensity: 1.0, temperature: 'warm', blenderPrimitive: 'pendant-light' },
    priority: 90
  }),
  makeAsset({
    id: 'track-light-industrial-black',
    name: '工业风黑色轨道灯',
    category: 'lighting',
    usage: '用于工业风客厅、餐厅、走廊或开放空间基础照明。',
    sceneTypes: ['living', 'dining', 'space', 'entry', 'hallway'],
    placement: 'place_on_ceiling_grid',
    aiDescription: 'Black industrial track lighting with warm focused spots.',
    tags: ['工业风', '轨道灯', '黑色金属', '照明'],
    properties: { color: '#fff0d0', secondaryColor: '#1f1f1f', intensity: 1.05, temperature: 'warm', blenderPrimitive: 'area-light' },
    priority: 92
  }),
  makeAsset({
    id: 'linear-light-luxury-gold',
    name: '轻奢金属线性灯',
    category: 'lighting',
    usage: '用于客厅、餐厅或卧室局部吊顶，增加细金属线条和精致感。',
    sceneTypes: ['living', 'dining', 'bedroom', 'entry'],
    placement: 'place_on_ceiling_grid',
    aiDescription: 'Slim champagne gold linear light for modern light luxury interiors.',
    tags: ['轻奢', '现代轻奢', '金属', '线性灯', '暖光'],
    properties: { color: '#fff4dc', secondaryColor: '#c49a4a', intensity: 1.0, temperature: 'warm', blenderPrimitive: 'area-light' },
    priority: 84
  }),
  makeAsset({
    id: 'pendant-cream-globe',
    name: '奶油风圆球吊灯',
    category: 'lighting',
    usage: '用于奶油风餐厅、卧室或客厅角落，提供柔和暖光。',
    sceneTypes: ['living', 'dining', 'bedroom'],
    placement: 'hang_above_dining_table',
    aiDescription: 'Cream style warm globe pendant light for soft residential interiors.',
    tags: ['奶油风', '吊灯', '圆球灯', '暖光', '餐厅'],
    properties: { color: '#fff1d6', secondaryColor: '#d2b889', intensity: 0.95, temperature: 'warm', blenderPrimitive: 'pendant-light' },
    priority: 94
  }),
  makeAsset({
    id: 'sofa-green-modern',
    name: '墨绿色现代沙发',
    category: 'furniture',
    usage: '用于客厅主视觉家具，放置在电视墙或窗边对侧，形成会客区。',
    sceneTypes: ['living', 'space'],
    placement: 'place_against_long_wall_or_facing_tv',
    aiDescription: 'Modern deep green sofa in living room seating area.',
    tags: ['家具', '客厅', '沙发', '软装'],
    properties: { color: '#2f5d50', secondaryColor: '#1f3d35', scale: 'large', material: 'fabric', blenderPrimitive: 'sofa' },
    priority: 95
  }),
  makeAsset({
    id: 'sofa-new-chinese-wood-frame',
    name: '新中式木框布艺沙发',
    category: 'furniture',
    usage: '用于新中式客厅主沙发，靠长墙或面对电视背景墙布置。',
    sceneTypes: ['living', 'space'],
    placement: 'place_against_long_wall_or_facing_tv',
    aiDescription: 'New Chinese sofa with walnut wood frame and beige fabric cushions.',
    tags: ['新中式', '沙发', '胡桃木', '布艺', '客厅'],
    properties: { color: '#d8c7ad', secondaryColor: '#573824', scale: 'large', material: 'fabric-wood', role: 'primary_seating', blenderPrimitive: 'sofa' },
    priority: 99
  }),
  makeAsset({
    id: 'sofa-industrial-leather',
    name: '工业风棕色皮沙发',
    category: 'furniture',
    usage: '用于工业风客厅主视觉家具，适合水泥墙和黑色金属灯具搭配。',
    sceneTypes: ['living', 'space'],
    placement: 'place_against_long_wall_or_facing_tv',
    aiDescription: 'Industrial brown leather sofa for concrete and black metal interiors.',
    tags: ['工业风', '皮沙发', '棕色', '客厅', '软装'],
    properties: { color: '#7a4a2d', secondaryColor: '#2f2f2f', scale: 'large', material: 'leather', role: 'primary_seating', blenderPrimitive: 'sofa' },
    priority: 98
  }),
  makeAsset({
    id: 'sofa-cream-boucle',
    name: '奶油风羊羔绒沙发',
    category: 'furniture',
    usage: '用于奶油风客厅主沙发，适合浅色墙地和圆润茶几搭配。',
    sceneTypes: ['living', 'space'],
    placement: 'place_against_long_wall_or_facing_tv',
    aiDescription: 'Cream boucle sofa with soft rounded silhouette for warm residential living rooms.',
    tags: ['奶油风', '羊羔绒', '沙发', '圆润', '客厅'],
    properties: { color: '#eadfcd', secondaryColor: '#c7b79d', scale: 'large', material: 'fabric', role: 'primary_seating', blenderPrimitive: 'sofa' },
    priority: 91
  }),
  makeAsset({
    id: 'sofa-light-luxury-beige',
    name: '轻奢米色皮布沙发',
    category: 'furniture',
    usage: '用于现代轻奢客厅主沙发，搭配石材背景墙和金属线性灯。',
    sceneTypes: ['living', 'space'],
    placement: 'place_against_long_wall_or_facing_tv',
    aiDescription: 'Modern light luxury beige sofa with refined low profile.',
    tags: ['轻奢', '现代轻奢', '沙发', '米色', '客厅'],
    properties: { color: '#d8cbb8', secondaryColor: '#b68b3f', scale: 'large', material: 'leather-fabric', role: 'primary_seating', blenderPrimitive: 'sofa' },
    priority: 90
  }),
  makeAsset({
    id: 'coffee-table-white',
    name: '白色低矮茶几',
    category: 'furniture',
    usage: '用于客厅沙发前方，作为会客区中心家具。',
    sceneTypes: ['living', 'space'],
    placement: 'place_in_front_of_sofa',
    aiDescription: 'Low white coffee table centered in front of sofa.',
    tags: ['家具', '客厅', '茶几'],
    properties: { color: '#f8fafc', secondaryColor: '#cbd5e1', scale: 'medium', material: 'wood', blenderPrimitive: 'coffee-table' },
    priority: 82
  }),
  makeAsset({
    id: 'coffee-table-black-metal-wood',
    name: '工业风黑金属木茶几',
    category: 'furniture',
    usage: '用于工业风客厅沙发前方，黑色金属脚架搭配深木台面。',
    sceneTypes: ['living', 'space'],
    placement: 'place_in_front_of_sofa',
    aiDescription: 'Industrial coffee table with black metal frame and dark wood top.',
    tags: ['工业风', '茶几', '黑色金属', '深木色'],
    properties: { color: '#3b2a20', secondaryColor: '#111827', scale: 'medium', material: 'metal-wood', role: 'coffee_table', blenderPrimitive: 'coffee-table' },
    priority: 89
  }),
  makeAsset({
    id: 'coffee-table-cream-round',
    name: '奶油风圆形茶几',
    category: 'furniture',
    usage: '用于奶油风客厅沙发前，圆角造型降低小户型空间压迫感。',
    sceneTypes: ['living', 'space'],
    placement: 'place_in_front_of_sofa',
    aiDescription: 'Round cream coffee table for soft warm living room layouts.',
    tags: ['奶油风', '茶几', '圆形', '浅色', '小户型友好'],
    properties: { color: '#eee4d3', secondaryColor: '#bfae8c', scale: 'medium', material: 'wood', role: 'coffee_table', blenderPrimitive: 'coffee-table' },
    priority: 94
  }),
  makeAsset({
    id: 'coffee-table-new-chinese-walnut-square',
    name: '新中式胡桃木方茶几',
    category: 'furniture',
    usage: '用于新中式客厅沙发前方，和胡桃木电视柜、格栅背景呼应。',
    sceneTypes: ['living', 'space'],
    placement: 'place_in_front_of_sofa',
    aiDescription: 'New Chinese square walnut coffee table in front of sofa.',
    tags: ['新中式', '茶几', '胡桃木', '客厅', '收纳'],
    properties: { color: '#623b25', secondaryColor: '#d8c7ad', scale: 'medium', material: 'wood', role: 'coffee_table', blenderPrimitive: 'coffee-table' },
    priority: 95
  }),
  makeAsset({
    id: 'coffee-table-light-luxury-marble',
    name: '轻奢岩板圆茶几',
    category: 'furniture',
    usage: '用于轻奢客厅沙发前，圆形岩板台面搭配香槟金属底座。',
    sceneTypes: ['living', 'space'],
    placement: 'place_in_front_of_sofa',
    aiDescription: 'Light luxury round marble coffee table with champagne metal base.',
    tags: ['轻奢', '现代轻奢', '茶几', '岩板', '金属'],
    properties: { color: '#ded6c8', secondaryColor: '#b68b3f', scale: 'medium', material: 'stone-metal', role: 'coffee_table', blenderPrimitive: 'coffee-table' },
    priority: 88
  }),
  makeAsset({
    id: 'tv-console-oak',
    name: '橡木电视柜',
    category: 'furniture',
    usage: '用于客厅电视墙下方，形成收纳和视听区。',
    sceneTypes: ['living'],
    placement: 'place_against_tv_wall',
    aiDescription: 'Low oak TV console against the main media wall.',
    tags: ['家具', '客厅', '电视柜', '收纳'],
    properties: { color: '#b98245', secondaryColor: '#5b3a20', material: 'wood', blenderPrimitive: 'tv-console' },
    priority: 76
  }),
  makeAsset({
    id: 'tv-console-new-chinese-walnut',
    name: '新中式胡桃木电视柜',
    category: 'furniture',
    usage: '用于新中式客厅电视墙下方，提供低矮收纳和深木色视觉锚点。',
    sceneTypes: ['living'],
    placement: 'place_against_tv_wall',
    aiDescription: 'Low walnut TV console for new Chinese living rooms.',
    tags: ['新中式', '电视柜', '胡桃木', '收纳', '客厅'],
    properties: { color: '#5f3924', secondaryColor: '#221915', material: 'wood', role: 'console', blenderPrimitive: 'tv-console' },
    priority: 92
  }),
  makeAsset({
    id: 'tv-console-light-luxury-stone',
    name: '轻奢石纹电视柜',
    category: 'furniture',
    usage: '用于现代轻奢客厅电视墙下方，以石纹台面和金属细节增强精致感。',
    sceneTypes: ['living'],
    placement: 'place_against_tv_wall',
    aiDescription: 'Light luxury TV console with stone surface and champagne metal trim.',
    tags: ['轻奢', '现代轻奢', '电视柜', '石纹', '金属'],
    properties: { color: '#ddd4c4', secondaryColor: '#b68b3f', material: 'stone-metal', role: 'console', blenderPrimitive: 'tv-console' },
    priority: 92
  }),
  makeAsset({
    id: 'rug-warm-wool',
    name: '暖灰羊毛地毯',
    category: 'soft_decor',
    usage: '用于客厅沙发和茶几下方，柔化空间并划分会客区域。',
    sceneTypes: ['living', 'bedroom'],
    placement: 'place_under_seating_or_bed',
    aiDescription: 'Warm gray wool rug under sofa group or bed.',
    tags: ['地毯', '软装', '客厅', '卧室'],
    properties: { color: '#d6d3d1', secondaryColor: '#a8a29e', material: 'fabric', blenderPrimitive: 'rug' },
    priority: 62
  }),
  makeAsset({
    id: 'rug-new-chinese-ink',
    name: '新中式水墨地毯',
    category: 'soft_decor',
    usage: '用于新中式客厅茶几下方或卧室床边，提供水墨纹理软装层次。',
    sceneTypes: ['living', 'bedroom'],
    placement: 'place_under_seating_or_bed',
    aiDescription: 'New Chinese ink wash rug under sofa group or bed.',
    tags: ['新中式', '地毯', '水墨', '软装', '客厅'],
    properties: { color: '#d8d0c2', secondaryColor: '#2f3433', material: 'fabric', blenderPrimitive: 'rug' },
    priority: 88
  }),
  makeAsset({
    id: 'rug-industrial-charcoal',
    name: '工业风炭灰地毯',
    category: 'soft_decor',
    usage: '用于工业风客厅沙发和茶几下方，压住灰色水泥空间的会客区。',
    sceneTypes: ['living', 'bedroom'],
    placement: 'place_under_seating_or_bed',
    aiDescription: 'Charcoal industrial rug beneath living room sofa group.',
    tags: ['工业风', '地毯', '炭灰', '软装', '客厅'],
    properties: { color: '#4a4a46', secondaryColor: '#202020', material: 'fabric', blenderPrimitive: 'rug' },
    priority: 87
  }),
  makeAsset({
    id: 'dining-table-oak-round',
    name: '圆形橡木餐桌',
    category: 'furniture',
    usage: '用于餐厅中心，适合中小户型餐厨相邻空间。',
    sceneTypes: ['dining', 'living'],
    placement: 'place_center_of_dining_area',
    aiDescription: 'Round oak dining table for compact dining zone.',
    tags: ['家具', '餐厅', '餐桌'],
    properties: { color: '#bf8f5a', secondaryColor: '#6b4423', material: 'wood', blenderPrimitive: 'dining-table' },
    priority: 88
  }),
  makeAsset({
    id: 'dining-table-new-chinese-walnut-round',
    name: '新中式圆形胡桃木餐桌',
    category: 'furniture',
    usage: '用于餐厅中心，适合新中式家庭围合式用餐氛围。',
    sceneTypes: ['dining', 'living'],
    placement: 'place_center_of_dining_area',
    aiDescription: 'Round walnut dining table for new Chinese dining rooms.',
    tags: ['新中式', '餐桌', '胡桃木', '圆桌', '餐厅'],
    properties: { color: '#6a4027', secondaryColor: '#2f2118', material: 'wood', role: 'dining_table', blenderPrimitive: 'dining-table' },
    priority: 93
  }),
  makeAsset({
    id: 'dining-table-industrial-metal-wood',
    name: '工业风金属木餐桌',
    category: 'furniture',
    usage: '用于工业风餐厅或开放式餐厨区，搭配黑色金属餐椅。',
    sceneTypes: ['dining', 'living'],
    placement: 'place_center_of_dining_area',
    aiDescription: 'Industrial dining table with dark wood top and black metal base.',
    tags: ['工业风', '餐桌', '黑色金属', '深木色', '餐厅'],
    properties: { color: '#4a2f22', secondaryColor: '#111827', material: 'metal-wood', role: 'dining_table', blenderPrimitive: 'dining-table' },
    priority: 92
  }),
  makeAsset({
    id: 'dining-table-cream-round',
    name: '奶油风圆形餐桌',
    category: 'furniture',
    usage: '用于奶油风餐厅或客餐厅一体空间，浅色圆桌适合中小户型。',
    sceneTypes: ['dining', 'living'],
    placement: 'place_center_of_dining_area',
    aiDescription: 'Cream round dining table for compact warm dining spaces.',
    tags: ['奶油风', '餐桌', '圆桌', '浅色', '小户型友好'],
    properties: { color: '#eadfcd', secondaryColor: '#c9b89c', material: 'wood', role: 'dining_table', blenderPrimitive: 'dining-table' },
    priority: 94
  }),
  makeAsset({
    id: 'dining-table-light-luxury-stone',
    name: '轻奢岩板餐桌',
    category: 'furniture',
    usage: '用于现代轻奢餐厅，岩板桌面搭配香槟金属底座。',
    sceneTypes: ['dining', 'living'],
    placement: 'place_center_of_dining_area',
    aiDescription: 'Light luxury stone dining table with champagne metal base.',
    tags: ['轻奢', '现代轻奢', '餐桌', '岩板', '金属'],
    properties: { color: '#ded6c8', secondaryColor: '#b68b3f', material: 'stone-metal', role: 'dining_table', blenderPrimitive: 'dining-table' },
    priority: 87
  }),
  makeAsset({
    id: 'dining-chair-fabric',
    name: '米灰布艺餐椅',
    category: 'furniture',
    usage: '用于餐桌周边，通常 2-4 把成组布置。',
    sceneTypes: ['dining', 'living'],
    placement: 'place_around_dining_table',
    aiDescription: 'Greige fabric dining chairs around the dining table.',
    tags: ['家具', '餐厅', '餐椅'],
    properties: { color: '#c9c0b4', secondaryColor: '#6b7280', material: 'fabric', count: 4, role: 'dining_chair', blenderPrimitive: 'dining-chair' },
    priority: 72
  }),
  makeAsset({
    id: 'dining-chair-new-chinese-walnut',
    name: '新中式胡桃木餐椅',
    category: 'furniture',
    usage: '用于新中式餐桌周边，通常 2-4 把围合布置。',
    sceneTypes: ['dining', 'living'],
    placement: 'place_around_dining_table',
    aiDescription: 'New Chinese walnut dining chairs with beige cushions.',
    tags: ['新中式', '餐椅', '胡桃木', '餐厅'],
    properties: { color: '#5b3824', secondaryColor: '#d8c7ad', material: 'wood-fabric', count: 4, role: 'dining_chair', blenderPrimitive: 'dining-chair' },
    priority: 88
  }),
  makeAsset({
    id: 'dining-chair-industrial-black',
    name: '工业风黑色金属餐椅',
    category: 'furniture',
    usage: '用于工业风餐桌周边，黑色金属框架和深色坐面呼应水泥墙。',
    sceneTypes: ['dining', 'living'],
    placement: 'place_around_dining_table',
    aiDescription: 'Industrial black metal dining chairs around dark wood table.',
    tags: ['工业风', '餐椅', '黑色金属', '餐厅'],
    properties: { color: '#1f1f1f', secondaryColor: '#6b3f28', material: 'metal-leather', count: 4, role: 'dining_chair', blenderPrimitive: 'dining-chair' },
    priority: 87
  }),
  makeAsset({
    id: 'dining-chair-light-luxury-beige',
    name: '轻奢米色餐椅',
    category: 'furniture',
    usage: '用于轻奢餐厅，米色软包搭配香槟金属脚。',
    sceneTypes: ['dining', 'living'],
    placement: 'place_around_dining_table',
    aiDescription: 'Light luxury beige upholstered dining chairs with champagne legs.',
    tags: ['轻奢', '现代轻奢', '餐椅', '软包', '金属'],
    properties: { color: '#d8cbb8', secondaryColor: '#b68b3f', material: 'fabric-metal', count: 4, role: 'dining_chair', blenderPrimitive: 'dining-chair' },
    priority: 84
  }),
  makeAsset({
    id: 'bed-queen-warm-gray',
    name: '暖灰双人床',
    category: 'furniture',
    usage: '用于主卧或次卧核心家具，床头靠实墙布置。',
    sceneTypes: ['bedroom'],
    placement: 'place_headboard_against_solid_wall',
    aiDescription: 'Warm gray upholstered queen bed with simple headboard.',
    tags: ['家具', '卧室', '床'],
    properties: { color: '#8b8791', secondaryColor: '#d6d3d1', material: 'fabric', blenderPrimitive: 'bed' },
    priority: 95
  }),
  makeAsset({
    id: 'wardrobe-white-oak',
    name: '白橡木衣柜',
    category: 'cabinet',
    usage: '用于卧室长墙收纳，不遮挡门窗和床侧通道。',
    sceneTypes: ['bedroom'],
    placement: 'place_along_bedroom_long_wall',
    aiDescription: 'White and oak wardrobe along bedroom wall.',
    tags: ['卧室', '衣柜', '收纳'],
    properties: { color: '#f8fafc', secondaryColor: '#c8a676', material: 'wood', blenderPrimitive: 'wardrobe' },
    priority: 82
  }),
  makeAsset({
    id: 'wardrobe-walnut-lattice',
    name: '新中式胡桃木衣柜',
    category: 'cabinet',
    usage: '用于新中式卧室长墙收纳，深胡桃木门板搭配细格栅线条。',
    sceneTypes: ['bedroom'],
    placement: 'place_along_bedroom_long_wall',
    aiDescription: 'Walnut wardrobe with subtle lattice lines for new Chinese bedrooms.',
    tags: ['新中式', '衣柜', '胡桃木', '格栅', '全屋定制'],
    properties: { color: '#62402a', secondaryColor: '#d2bea1', material: 'wood', blenderPrimitive: 'wardrobe' },
    priority: 89
  }),
  makeAsset({
    id: 'wardrobe-cream-flat-panel',
    name: '奶油风平板衣柜',
    category: 'cabinet',
    usage: '用于奶油风卧室长墙收纳，浅米色平板门减少视觉割裂。',
    sceneTypes: ['bedroom'],
    placement: 'place_along_bedroom_long_wall',
    aiDescription: 'Cream flat-panel wardrobe for warm compact Chinese bedrooms.',
    tags: ['奶油风', '衣柜', '浅米色', '全屋定制', '卧室'],
    properties: { color: '#eadfcd', secondaryColor: '#c9b89c', material: 'wood', blenderPrimitive: 'wardrobe' },
    priority: 84
  }),
  makeAsset({
    id: 'wardrobe-industrial-dark-metal',
    name: '工业风深灰金属衣柜',
    category: 'cabinet',
    usage: '用于工业风卧室或玄关收纳，深灰柜门搭配黑色金属拉手。',
    sceneTypes: ['bedroom', 'entry'],
    placement: 'place_along_bedroom_long_wall',
    aiDescription: 'Industrial dark gray wardrobe with black metal pulls.',
    tags: ['工业风', '衣柜', '深灰', '黑色金属', '全屋定制'],
    properties: { color: '#3f4346', secondaryColor: '#111827', material: 'metal-wood', blenderPrimitive: 'wardrobe' },
    priority: 86
  }),
  makeAsset({
    id: 'wardrobe-light-luxury-glass',
    name: '轻奢玻璃衣柜',
    category: 'cabinet',
    usage: '用于现代轻奢卧室长墙收纳，烟灰玻璃和金属边框营造精致感。',
    sceneTypes: ['bedroom'],
    placement: 'place_along_bedroom_long_wall',
    aiDescription: 'Light luxury smoked glass wardrobe with champagne metal frame.',
    tags: ['轻奢', '现代轻奢', '衣柜', '玻璃', '金属'],
    properties: { color: '#6b6f72', secondaryColor: '#b68b3f', material: 'glass-metal', alpha: 0.5, blenderPrimitive: 'wardrobe' },
    priority: 83
  }),
  makeAsset({
    id: 'kitchen-cabinet-new-chinese-walnut',
    name: '新中式胡桃木厨房柜',
    category: 'cabinet',
    usage: '用于新中式厨房地柜和吊柜，深胡桃木门板搭配浅色台面。',
    sceneTypes: ['kitchen'],
    placement: 'place_along_kitchen_wall',
    aiDescription: 'New Chinese walnut kitchen cabinets with light countertop.',
    tags: ['新中式', '厨房', '橱柜', '胡桃木', '全屋定制'],
    properties: { color: '#5b3824', secondaryColor: '#e5dccd', material: 'wood-stone', blenderPrimitive: 'kitchen-cabinet' },
    priority: 92
  }),
  makeAsset({
    id: 'kitchen-cabinet-industrial-dark',
    name: '工业风深灰厨房柜',
    category: 'cabinet',
    usage: '用于工业风厨房，深灰柜门、黑色金属拉手和水泥墙地面协调。',
    sceneTypes: ['kitchen'],
    placement: 'place_along_kitchen_wall',
    aiDescription: 'Industrial dark gray kitchen cabinets with black metal details.',
    tags: ['工业风', '厨房', '橱柜', '深灰', '黑色金属'],
    properties: { color: '#3f4346', secondaryColor: '#111827', material: 'metal-wood', blenderPrimitive: 'kitchen-cabinet' },
    priority: 93
  }),
  makeAsset({
    id: 'kitchen-cabinet-cream-ivory',
    name: '奶油风象牙白厨房柜',
    category: 'cabinet',
    usage: '用于奶油风厨房，浅色柜门搭配浅石纹台面，适合国内精装改造。',
    sceneTypes: ['kitchen'],
    placement: 'place_along_kitchen_wall',
    aiDescription: 'Cream ivory kitchen cabinets with soft stone countertop.',
    tags: ['奶油风', '厨房', '橱柜', '象牙白', '全屋定制'],
    properties: { color: '#eadfcd', secondaryColor: '#c9b89c', material: 'wood-stone', blenderPrimitive: 'kitchen-cabinet' },
    priority: 94
  }),
  makeAsset({
    id: 'kitchen-cabinet-light-luxury',
    name: '轻奢岩板厨房柜',
    category: 'cabinet',
    usage: '用于现代轻奢厨房，浅灰柜门、岩板台面与香槟金属线条搭配。',
    sceneTypes: ['kitchen'],
    placement: 'place_along_kitchen_wall',
    aiDescription: 'Light luxury kitchen cabinets with stone top and champagne trim.',
    tags: ['轻奢', '现代轻奢', '厨房', '橱柜', '岩板'],
    properties: { color: '#d8d0c2', secondaryColor: '#b68b3f', material: 'stone-metal', blenderPrimitive: 'kitchen-cabinet' },
    priority: 91
  }),
  makeAsset({
    id: 'kitchen-cabinet-white-oak',
    name: '白色橡木厨房柜',
    category: 'cabinet',
    usage: '用于厨房地柜和吊柜，沿厨房长墙或 L 型墙面布置。',
    sceneTypes: ['kitchen'],
    placement: 'place_along_kitchen_wall',
    aiDescription: 'White and oak kitchen cabinets aligned to longest kitchen wall.',
    tags: ['厨房', '橱柜', '收纳', '家具'],
    properties: { color: '#f8fafc', secondaryColor: '#c8a676', material: 'wood', blenderPrimitive: 'kitchen-cabinet' },
    priority: 95
  }),
  makeAsset({
    id: 'bathroom-vanity-white',
    name: '白色浴室柜',
    category: 'cabinet',
    usage: '用于卫生间洗漱区，靠近门口或干区墙面布置。',
    sceneTypes: ['bathroom'],
    placement: 'place_near_bathroom_entry_or_dry_zone',
    aiDescription: 'White bathroom vanity cabinet with countertop basin.',
    tags: ['卫生间', '浴室柜', '洗漱'],
    properties: { color: '#f8fafc', secondaryColor: '#bae6fd', material: 'ceramic', blenderPrimitive: 'bathroom-vanity' },
    priority: 86
  }),
  makeAsset({
    id: 'bathroom-vanity-new-chinese-walnut',
    name: '新中式胡桃木浴室柜',
    category: 'cabinet',
    usage: '用于新中式卫生间干区，胡桃木柜体搭配浅色台盆。',
    sceneTypes: ['bathroom'],
    placement: 'place_near_bathroom_entry_or_dry_zone',
    aiDescription: 'New Chinese walnut bathroom vanity with light ceramic basin.',
    tags: ['新中式', '卫生间', '浴室柜', '胡桃木', '干湿分离'],
    properties: { color: '#5b3824', secondaryColor: '#f2eee6', material: 'wood-ceramic', blenderPrimitive: 'bathroom-vanity' },
    priority: 88
  }),
  makeAsset({
    id: 'bathroom-vanity-industrial-concrete',
    name: '工业风水泥浴室柜',
    category: 'cabinet',
    usage: '用于工业风卫生间干区，灰色柜体和黑色五金呼应水泥墙地。',
    sceneTypes: ['bathroom'],
    placement: 'place_near_bathroom_entry_or_dry_zone',
    aiDescription: 'Industrial concrete gray bathroom vanity with black fixtures.',
    tags: ['工业风', '卫生间', '浴室柜', '水泥', '黑色金属'],
    properties: { color: '#5f5f5a', secondaryColor: '#111827', material: 'concrete-metal', blenderPrimitive: 'bathroom-vanity' },
    priority: 89
  }),
  makeAsset({
    id: 'bathroom-vanity-cream',
    name: '奶油风浅米浴室柜',
    category: 'cabinet',
    usage: '用于奶油风卫生间干区，浅米柜体和柔和台面适合小户型。',
    sceneTypes: ['bathroom'],
    placement: 'place_near_bathroom_entry_or_dry_zone',
    aiDescription: 'Cream bathroom vanity with warm ivory cabinet and ceramic basin.',
    tags: ['奶油风', '卫生间', '浴室柜', '浅米色', '干湿分离'],
    properties: { color: '#eadfcd', secondaryColor: '#ffffff', material: 'wood-ceramic', blenderPrimitive: 'bathroom-vanity' },
    priority: 90
  }),
  makeAsset({
    id: 'bathroom-vanity-light-luxury',
    name: '轻奢悬浮浴室柜',
    category: 'cabinet',
    usage: '用于现代轻奢卫生间干区，岩板台面和金属线条形成精致感。',
    sceneTypes: ['bathroom'],
    placement: 'place_near_bathroom_entry_or_dry_zone',
    aiDescription: 'Light luxury floating bathroom vanity with stone and champagne trim.',
    tags: ['轻奢', '现代轻奢', '卫生间', '浴室柜', '岩板'],
    properties: { color: '#d8d0c2', secondaryColor: '#b68b3f', material: 'stone-metal', blenderPrimitive: 'bathroom-vanity' },
    priority: 87
  }),
  makeAsset({
    id: 'toilet-white-ceramic',
    name: '白色陶瓷马桶',
    category: 'sanitary',
    usage: '用于卫生间坐便区，需避开门扇开启和淋浴区。',
    sceneTypes: ['bathroom'],
    placement: 'place_against_bathroom_wall',
    aiDescription: 'White ceramic toilet placed against bathroom wall.',
    tags: ['卫生间', '洁具', '马桶'],
    properties: { color: '#ffffff', secondaryColor: '#cbd5e1', material: 'ceramic', blenderPrimitive: 'toilet' },
    priority: 72
  }),
  makeAsset({
    id: 'toilet-smart-white',
    name: '智能一体马桶',
    category: 'sanitary',
    usage: '用于国内常见改善型卫生间坐便区，适合奶油风和轻奢风格。',
    sceneTypes: ['bathroom'],
    placement: 'place_against_bathroom_wall',
    aiDescription: 'Smart integrated white toilet for upgraded Chinese bathrooms.',
    tags: ['智能马桶', '卫生间', '洁具', '奶油风', '轻奢'],
    properties: { color: '#ffffff', secondaryColor: '#d8d0c2', material: 'ceramic', blenderPrimitive: 'toilet' },
    priority: 82
  }),
  makeAsset({
    id: 'shower-glass-partition',
    name: '透明淋浴隔断',
    category: 'sanitary',
    usage: '用于卫生间湿区边界，形成干湿分离。',
    sceneTypes: ['bathroom'],
    placement: 'place_between_shower_and_dry_zone',
    aiDescription: 'Transparent glass shower partition for wet-dry separation.',
    tags: ['卫生间', '淋浴', '玻璃隔断'],
    properties: { color: '#dbeafe', secondaryColor: '#38bdf8', material: 'glass', alpha: 0.35, blenderPrimitive: 'glass-partition' },
    priority: 60
  }),
  makeAsset({
    id: 'shower-black-frame-partition',
    name: '黑框淋浴隔断',
    category: 'sanitary',
    usage: '用于工业风或轻奢卫生间湿区，形成干湿分离和黑框线条。',
    sceneTypes: ['bathroom'],
    placement: 'place_between_shower_and_dry_zone',
    aiDescription: 'Black framed glass shower partition for wet-dry separation.',
    tags: ['工业风', '轻奢', '卫生间', '淋浴隔断', '黑框'],
    properties: { color: '#dbeafe', secondaryColor: '#111827', material: 'glass-metal', alpha: 0.35, blenderPrimitive: 'glass-partition' },
    priority: 80
  }),
  makeAsset({
    id: 'appliance-fridge-cream-integrated',
    name: '奶油风嵌入式冰箱',
    category: 'appliance',
    usage: '用于厨房高柜旁或餐厨一体空间，浅色面板适合奶油风和精装改造。',
    sceneTypes: ['kitchen', 'dining'],
    placement: 'place_near_kitchen_tall_cabinet',
    aiDescription: 'Cream integrated refrigerator panel for warm Chinese kitchens.',
    tags: ['奶油风', '厨房', '冰箱', '嵌入式', '家电'],
    properties: { color: '#eadfcd', secondaryColor: '#c9b89c', material: 'painted-metal', role: 'refrigerator', blenderPrimitive: 'refrigerator' },
    priority: 90
  }),
  makeAsset({
    id: 'appliance-fridge-industrial-black',
    name: '工业风黑色冰箱',
    category: 'appliance',
    usage: '用于工业风厨房或开放餐厨区，黑色金属面板和深灰柜体协调。',
    sceneTypes: ['kitchen', 'dining'],
    placement: 'place_near_kitchen_tall_cabinet',
    aiDescription: 'Black industrial refrigerator for concrete and dark cabinet kitchens.',
    tags: ['工业风', '厨房', '冰箱', '黑色金属', '家电'],
    properties: { color: '#222529', secondaryColor: '#6b6f72', material: 'metal', role: 'refrigerator', blenderPrimitive: 'refrigerator' },
    priority: 91
  }),
  makeAsset({
    id: 'appliance-fridge-light-luxury-steel',
    name: '轻奢不锈钢冰箱',
    category: 'appliance',
    usage: '用于现代轻奢厨房，高柜区或餐厨一体空间。',
    sceneTypes: ['kitchen', 'dining'],
    placement: 'place_near_kitchen_tall_cabinet',
    aiDescription: 'Light luxury stainless refrigerator with subtle champagne trim.',
    tags: ['轻奢', '现代轻奢', '厨房', '冰箱', '不锈钢'],
    properties: { color: '#c7c4bd', secondaryColor: '#b68b3f', material: 'metal', role: 'refrigerator', blenderPrimitive: 'refrigerator' },
    priority: 88
  }),
  makeAsset({
    id: 'appliance-fridge-new-chinese-panel',
    name: '新中式深木饰面冰箱',
    category: 'appliance',
    usage: '用于新中式厨房高柜区，以深木饰面弱化家电突兀感。',
    sceneTypes: ['kitchen', 'dining'],
    placement: 'place_near_kitchen_tall_cabinet',
    aiDescription: 'New Chinese refrigerator with dark walnut integrated panel.',
    tags: ['新中式', '厨房', '冰箱', '胡桃木', '嵌入式'],
    properties: { color: '#5b3824', secondaryColor: '#d8c7ad', material: 'wood-metal', role: 'refrigerator', blenderPrimitive: 'refrigerator' },
    priority: 89
  }),
  makeAsset({
    id: 'appliance-range-hood-black',
    name: '黑色侧吸油烟机',
    category: 'appliance',
    usage: '用于厨房灶台上方，适合工业风、轻奢或现代厨房。',
    sceneTypes: ['kitchen'],
    placement: 'place_above_kitchen_cooktop',
    aiDescription: 'Black range hood above cooktop for Chinese kitchens.',
    tags: ['厨房', '油烟机', '黑色', '工业风', '轻奢'],
    properties: { color: '#171717', secondaryColor: '#4b5563', material: 'metal-glass', role: 'range_hood', blenderPrimitive: 'range-hood' },
    priority: 86
  }),
  makeAsset({
    id: 'appliance-range-hood-cream',
    name: '奶油风浅色油烟机',
    category: 'appliance',
    usage: '用于奶油风厨房灶台上方，浅色面板减少视觉压迫。',
    sceneTypes: ['kitchen'],
    placement: 'place_above_kitchen_cooktop',
    aiDescription: 'Cream light color range hood above cooktop.',
    tags: ['奶油风', '厨房', '油烟机', '浅色', '家电'],
    properties: { color: '#eadfcd', secondaryColor: '#c9b89c', material: 'painted-metal', role: 'range_hood', blenderPrimitive: 'range-hood' },
    priority: 87
  }),
  makeAsset({
    id: 'appliance-range-hood-new-chinese',
    name: '新中式深木饰面油烟机',
    category: 'appliance',
    usage: '用于新中式厨房灶台上方，以深木饰面或深色面板融入胡桃木橱柜。',
    sceneTypes: ['kitchen'],
    placement: 'place_above_kitchen_cooktop',
    aiDescription: 'New Chinese range hood with dark walnut toned front panel.',
    tags: ['新中式', '厨房', '油烟机', '胡桃木', '家电'],
    properties: { color: '#4f321f', secondaryColor: '#111827', material: 'wood-metal', role: 'range_hood', blenderPrimitive: 'range-hood' },
    priority: 90
  }),
  makeAsset({
    id: 'appliance-washer-balcony-white',
    name: '阳台滚筒洗衣机',
    category: 'appliance',
    usage: '用于生活阳台洗衣柜旁，表达国内常见洗晒阳台功能。',
    sceneTypes: ['balcony', 'bathroom'],
    placement: 'place_near_balcony_laundry_cabinet',
    aiDescription: 'White front-load washing machine for Chinese utility balcony.',
    tags: ['阳台', '洗衣机', '生活阳台', '奶油风', '家电'],
    properties: { color: '#f8fafc', secondaryColor: '#94a3b8', material: 'metal-glass', role: 'washing_machine', blenderPrimitive: 'washing-machine' },
    priority: 92
  }),
  makeAsset({
    id: 'appliance-washer-industrial-dark',
    name: '工业风深色洗衣机',
    category: 'appliance',
    usage: '用于工业风生活阳台或卫生间洗衣区。',
    sceneTypes: ['balcony', 'bathroom'],
    placement: 'place_near_balcony_laundry_cabinet',
    aiDescription: 'Dark front-load washer for industrial balcony or bathroom utility zone.',
    tags: ['工业风', '阳台', '洗衣机', '深灰', '家电'],
    properties: { color: '#3f4346', secondaryColor: '#111827', material: 'metal-glass', role: 'washing_machine', blenderPrimitive: 'washing-machine' },
    priority: 88
  }),
  makeAsset({
    id: 'appliance-mirror-cabinet-cream',
    name: '奶油风镜柜',
    category: 'appliance',
    usage: '用于奶油风卫生间洗漱区，上方镜柜补充收纳。',
    sceneTypes: ['bathroom'],
    placement: 'place_above_bathroom_vanity',
    aiDescription: 'Cream bathroom mirror cabinet above vanity.',
    tags: ['奶油风', '卫生间', '镜柜', '收纳', '干湿分离'],
    properties: { color: '#eadfcd', secondaryColor: '#dbeafe', material: 'mirror-wood', role: 'mirror_cabinet', blenderPrimitive: 'mirror-cabinet' },
    priority: 86
  }),
  makeAsset({
    id: 'appliance-mirror-cabinet-light-luxury',
    name: '轻奢带灯镜柜',
    category: 'appliance',
    usage: '用于现代轻奢卫生间洗漱区，镜面和金属边框提升精致度。',
    sceneTypes: ['bathroom'],
    placement: 'place_above_bathroom_vanity',
    aiDescription: 'Light luxury illuminated mirror cabinet with champagne trim.',
    tags: ['轻奢', '现代轻奢', '卫生间', '镜柜', '金属'],
    properties: { color: '#dbeafe', secondaryColor: '#b68b3f', material: 'mirror-metal', role: 'mirror_cabinet', blenderPrimitive: 'mirror-cabinet' },
    priority: 85
  }),
  makeAsset({
    id: 'appliance-mirror-cabinet-new-chinese',
    name: '新中式胡桃木镜柜',
    category: 'appliance',
    usage: '用于新中式卫生间洗漱区，胡桃木边框镜柜和浴室柜协调。',
    sceneTypes: ['bathroom'],
    placement: 'place_above_bathroom_vanity',
    aiDescription: 'New Chinese bathroom mirror cabinet with walnut frame.',
    tags: ['新中式', '卫生间', '镜柜', '胡桃木', '收纳'],
    properties: { color: '#5b3824', secondaryColor: '#dbeafe', material: 'mirror-wood', role: 'mirror_cabinet', blenderPrimitive: 'mirror-cabinet' },
    priority: 88
  }),
  makeAsset({
    id: 'appliance-mirror-cabinet-industrial',
    name: '工业风黑框镜柜',
    category: 'appliance',
    usage: '用于工业风卫生间洗漱区，黑色金属边框镜柜和水泥浴室柜协调。',
    sceneTypes: ['bathroom'],
    placement: 'place_above_bathroom_vanity',
    aiDescription: 'Industrial black framed bathroom mirror cabinet above vanity.',
    tags: ['工业风', '卫生间', '镜柜', '黑色金属', '收纳'],
    properties: { color: '#1f1f1f', secondaryColor: '#dbeafe', material: 'mirror-metal', role: 'mirror_cabinet', blenderPrimitive: 'mirror-cabinet' },
    priority: 89
  }),
  makeAsset({
    id: 'curtain-warm-linen',
    name: '暖灰亚麻窗帘',
    category: 'soft_decor',
    usage: '用于卧室、客厅窗边，柔化窗洞和光线。',
    sceneTypes: ['living', 'bedroom', 'dining'],
    placement: 'place_near_window_wall',
    aiDescription: 'Warm gray linen curtains along window wall.',
    tags: ['窗帘', '软装', '窗边'],
    properties: { color: '#c7bfb3', secondaryColor: '#8b8791', material: 'linen', blenderPrimitive: 'curtain' },
    priority: 58
  }),
  makeAsset({
    id: 'curtain-new-chinese-linen',
    name: '新中式素麻窗帘',
    category: 'soft_decor',
    usage: '用于新中式客厅、卧室或餐厅窗边，降低深木色空间的厚重感。',
    sceneTypes: ['living', 'bedroom', 'dining'],
    placement: 'place_near_window_wall',
    aiDescription: 'New Chinese natural linen curtains in warm beige.',
    tags: ['新中式', '窗帘', '素麻', '软装', '窗边'],
    properties: { color: '#d8c7ad', secondaryColor: '#5b3824', material: 'linen', blenderPrimitive: 'curtain' },
    priority: 82
  }),
  makeAsset({
    id: 'curtain-industrial-charcoal',
    name: '工业风炭灰窗帘',
    category: 'soft_decor',
    usage: '用于工业风客厅或卧室窗边，配合水泥墙和黑色灯具。',
    sceneTypes: ['living', 'bedroom', 'dining'],
    placement: 'place_near_window_wall',
    aiDescription: 'Charcoal curtains for industrial living and bedroom windows.',
    tags: ['工业风', '窗帘', '炭灰', '软装', '窗边'],
    properties: { color: '#4a4a46', secondaryColor: '#202020', material: 'linen', blenderPrimitive: 'curtain' },
    priority: 81
  }),
  makeAsset({
    id: 'curtain-cream-sheer',
    name: '奶油风纱帘',
    category: 'soft_decor',
    usage: '用于奶油风客厅、卧室窗边，强化柔和透光感。',
    sceneTypes: ['living', 'bedroom', 'dining'],
    placement: 'place_near_window_wall',
    aiDescription: 'Cream sheer curtains for soft warm window treatment.',
    tags: ['奶油风', '纱帘', '窗帘', '柔光', '软装'],
    properties: { color: '#efe4d2', secondaryColor: '#c9b89c', material: 'linen', alpha: 0.58, blenderPrimitive: 'curtain' },
    priority: 83
  }),
  makeAsset({
    id: 'rug-light-luxury-silk',
    name: '轻奢浅金丝绒地毯',
    category: 'soft_decor',
    usage: '用于轻奢客厅沙发和茶几下方，提供浅金色软装层次。',
    sceneTypes: ['living', 'bedroom'],
    placement: 'place_under_seating_or_bed',
    aiDescription: 'Light luxury pale gold rug under sofa group or bed.',
    tags: ['轻奢', '现代轻奢', '地毯', '浅金', '软装'],
    properties: { color: '#d8cbb8', secondaryColor: '#b68b3f', material: 'fabric', blenderPrimitive: 'rug' },
    priority: 86
  }),
  makeAsset({
    id: 'balcony-plant-set',
    name: '阳台绿植组合',
    category: 'soft_decor',
    usage: '用于阳台、客厅窗边或入户角落，增加生活气息。',
    sceneTypes: ['balcony', 'living', 'entry'],
    placement: 'place_near_window_or_balcony_corner',
    aiDescription: 'Indoor plant set for balcony or window corner.',
    tags: ['绿植', '阳台', '软装'],
    properties: { color: '#3f7d4a', secondaryColor: '#7c5f38', material: 'plant', blenderPrimitive: 'plant-set' },
    priority: 56
  }),
  makeAsset({
    id: 'entry-cabinet-cream-shoe',
    name: '奶油风玄关鞋柜',
    category: 'cabinet',
    usage: '用于玄关入户墙面，浅色鞋柜适合国内小户型收纳。',
    sceneTypes: ['entry', 'hallway'],
    placement: 'place_along_entry_wall',
    aiDescription: 'Cream entry shoe cabinet for compact Chinese apartment foyers.',
    tags: ['奶油风', '玄关', '鞋柜', '全屋定制', '小户型友好'],
    properties: { color: '#eadfcd', secondaryColor: '#c9b89c', material: 'wood', blenderPrimitive: 'wardrobe' },
    priority: 88
  }),
  makeAsset({
    id: 'entry-cabinet-new-chinese-walnut',
    name: '新中式胡桃木玄关柜',
    category: 'cabinet',
    usage: '用于新中式玄关端景和鞋帽收纳，深木色柜体搭配留空台面。',
    sceneTypes: ['entry', 'hallway'],
    placement: 'place_along_entry_wall',
    aiDescription: 'New Chinese walnut entry cabinet with display niche.',
    tags: ['新中式', '玄关', '鞋柜', '胡桃木', '全屋定制'],
    properties: { color: '#5b3824', secondaryColor: '#d8c7ad', material: 'wood', blenderPrimitive: 'wardrobe' },
    priority: 89
  }),
  makeAsset({
    id: 'balcony-laundry-cabinet-cream',
    name: '奶油风阳台洗衣柜',
    category: 'cabinet',
    usage: '用于生活阳台洗衣机旁收纳，适合国内常见洗晒阳台。',
    sceneTypes: ['balcony'],
    placement: 'place_near_balcony_corner',
    aiDescription: 'Cream laundry cabinet for Chinese utility balcony.',
    tags: ['奶油风', '阳台', '洗衣柜', '生活阳台', '全屋定制'],
    properties: { color: '#eadfcd', secondaryColor: '#c9b89c', material: 'wood', blenderPrimitive: 'wardrobe' },
    priority: 84
  }),
  makeAsset({
    id: 'interior-door-warm-wood',
    name: '暖木色室内门',
    category: 'opening',
    usage: '用于房间门洞位置，和木地板色系协调。',
    sceneTypes: ['living', 'bedroom', 'bathroom', 'kitchen', 'space'],
    placement: 'place_on_door_opening',
    aiDescription: 'Warm wood interior door panel fitted to recognized door opening.',
    tags: ['门', '门洞', '木门'],
    properties: { color: '#a97142', secondaryColor: '#5b3a20', material: 'wood', blenderPrimitive: 'door' },
    priority: 66
  }),
  makeAsset({
    id: 'interior-door-new-chinese-walnut',
    name: '新中式胡桃木室内门',
    category: 'opening',
    usage: '用于新中式房间门洞，和胡桃木地板、柜体、格栅背景协调。',
    sceneTypes: ['living', 'bedroom', 'bathroom', 'kitchen', 'space'],
    placement: 'place_on_door_opening',
    aiDescription: 'Walnut interior door panel for new Chinese residential interiors.',
    tags: ['新中式', '门', '胡桃木', '木门', '门洞'],
    properties: { color: '#5d3824', secondaryColor: '#261b14', material: 'wood', blenderPrimitive: 'door' },
    priority: 90
  }),
  makeAsset({
    id: 'interior-door-industrial-black',
    name: '工业风黑框室内门',
    category: 'opening',
    usage: '用于工业风门洞，黑色门框搭配深灰门板或玻璃分格。',
    sceneTypes: ['living', 'bedroom', 'bathroom', 'kitchen', 'space'],
    placement: 'place_on_door_opening',
    aiDescription: 'Industrial black framed interior door for concrete interiors.',
    tags: ['工业风', '门', '黑框', '金属', '门洞'],
    properties: { color: '#2a2d2f', secondaryColor: '#111827', material: 'metal-wood', blenderPrimitive: 'door' },
    priority: 88
  }),
  makeAsset({
    id: 'interior-door-cream-ivory',
    name: '奶油风象牙白室内门',
    category: 'opening',
    usage: '用于奶油风房间门洞，和浅米墙面、奶油柜体保持整体感。',
    sceneTypes: ['living', 'bedroom', 'bathroom', 'kitchen', 'space'],
    placement: 'place_on_door_opening',
    aiDescription: 'Cream ivory interior door for warm light residential interiors.',
    tags: ['奶油风', '门', '象牙白', '木门', '门洞'],
    properties: { color: '#eadfcd', secondaryColor: '#c9b89c', material: 'wood', blenderPrimitive: 'door' },
    priority: 86
  }),
  makeAsset({
    id: 'interior-door-light-luxury-metal',
    name: '轻奢金属线条室内门',
    category: 'opening',
    usage: '用于现代轻奢门洞，浅色门板搭配细金属线条。',
    sceneTypes: ['living', 'bedroom', 'bathroom', 'kitchen', 'space'],
    placement: 'place_on_door_opening',
    aiDescription: 'Light luxury interior door with champagne metal trim.',
    tags: ['轻奢', '现代轻奢', '门', '金属线条', '门洞'],
    properties: { color: '#ded6c8', secondaryColor: '#b68b3f', material: 'wood-metal', blenderPrimitive: 'door' },
    priority: 84
  }),
  makeAsset({
    id: 'window-clear-glass',
    name: '透明玻璃窗',
    category: 'opening',
    usage: '用于识别到的窗洞位置，提供自然光来源。',
    sceneTypes: ['living', 'bedroom', 'kitchen', 'bathroom', 'dining', 'balcony'],
    placement: 'place_on_window_opening',
    aiDescription: 'Clear glass window assigned to recognized window opening.',
    tags: ['窗', '玻璃', '采光'],
    properties: { color: '#bfdbfe', secondaryColor: '#0ea5e9', material: 'glass', alpha: 0.42, blenderPrimitive: 'window' },
    priority: 66
  })
];

const sourceCatalog = [
  makeAsset({
    id: 'source-polyhaven-cc0',
    name: 'Poly Haven CC0 素材源',
    category: 'asset_source',
    usage: '推荐用于 HDRI、PBR 材质和部分 glTF 模型下载；所有具体素材下载后仍应记录文件名和来源 URL。',
    sceneTypes: ['living', 'bedroom', 'kitchen', 'bathroom', 'dining', 'space'],
    placement: 'external_source',
    aiDescription: 'CC0 HDRIs, textures and 3D models suitable for Blender rendering.',
    tags: ['CC0', 'HDRI', 'PBR', '模型', '外部素材源'],
    properties: { website: 'https://polyhaven.com/', licenseUrl: 'https://polyhaven.com/license' },
    license: 'CC0; verify individual downloaded asset metadata and keep source URL.',
    sourceType: 'external_catalog',
    sourceUrl: 'https://polyhaven.com/',
    priority: 100
  }),
  makeAsset({
    id: 'source-ambientcg-cc0',
    name: 'ambientCG CC0 材质源',
    category: 'asset_source',
    usage: '推荐用于木地板、瓷砖、石材、墙面等 PBR 材质贴图。',
    sceneTypes: ['living', 'bedroom', 'kitchen', 'bathroom', 'dining', 'space'],
    placement: 'external_source',
    aiDescription: 'CC0 PBR materials and HDRIs for architectural visualization.',
    tags: ['CC0', 'PBR', '材质', '贴图', '外部素材源'],
    properties: { website: 'https://ambientcg.com/', licenseUrl: 'https://docs.ambientcg.com/license/' },
    license: 'CC0; verify individual downloaded asset metadata and keep source URL.',
    sourceType: 'external_catalog',
    sourceUrl: 'https://ambientcg.com/',
    priority: 98
  }),
  makeAsset({
    id: 'source-kenney-cc0',
    name: 'Kenney CC0 低模资产源',
    category: 'asset_source',
    usage: '适合作为早期低模家具/道具占位资产，视觉偏游戏低模，不建议作为照片级终稿素材。',
    sceneTypes: ['living', 'bedroom', 'kitchen', 'bathroom', 'dining', 'space'],
    placement: 'external_source',
    aiDescription: 'CC0 low-poly 3D assets useful for placeholder models and prototyping.',
    tags: ['CC0', '低模', 'GLB', '占位', '外部素材源'],
    properties: { website: 'https://kenney.nl/assets', licenseUrl: 'https://kenney.nl/support' },
    license: 'CC0; suitable for commercial projects, but preserve source record.',
    sourceType: 'external_catalog',
    sourceUrl: 'https://kenney.nl/assets',
    priority: 70
  }),
  makeAsset({
    id: 'source-khronos-gltf-sample-assets',
    name: 'Khronos glTF 样例资产',
    category: 'asset_source',
    usage: '仅推荐用于 glTF 导入器测试和渲染管线验证；商用前必须逐个模型核验 license。',
    sceneTypes: ['space'],
    placement: 'external_source_for_testing',
    aiDescription: 'glTF sample assets for importer and renderer compatibility testing.',
    tags: ['glTF', '测试', '需核验授权', '外部素材源'],
    properties: { website: 'https://github.com/KhronosGroup/glTF-Sample-Assets' },
    license: 'Mixed licenses; do not treat the whole repository as commercial-ready.',
    sourceType: 'external_catalog',
    sourceUrl: 'https://github.com/KhronosGroup/glTF-Sample-Assets',
    priority: 20
  })
];

function mergeAssets(existing, seeded) {
  const byId = new Map(existing.map((asset) => [asset.id, asset]));
  for (const asset of seeded) {
    const previous = byId.get(asset.id) || {};
    byId.set(asset.id, {
      ...previous,
      ...asset,
      createdAt: previous.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
  return [...byId.values()].sort((a, b) => {
    const priorityDiff = Number(b.properties?.priority || 0) - Number(a.properties?.priority || 0);
    if (priorityDiff) {
      return priorityDiff;
    }
    return String(a.category || '').localeCompare(String(b.category || ''));
  });
}

function main() {
  ensureDir(path.dirname(dataFile));
  ensureDir(generatedDir);

  const seeded = [...proceduralAssets, ...sourceCatalog];
  for (const asset of seeded) {
    fs.writeFileSync(path.join(generatedDir, `${asset.id}.svg`), previewSvg(asset), 'utf8');
  }

  const existing = readExistingAssets();
  const merged = mergeAssets(existing, seeded);
  fs.writeFileSync(dataFile, JSON.stringify(merged, null, 2), 'utf8');

  console.log(JSON.stringify({
    dataFile,
    generatedDir,
    existing: existing.length,
    seeded: seeded.length,
    total: merged.length
  }, null, 2));
}

main();
