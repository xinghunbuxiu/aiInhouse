const express = require('express');

const router = express.Router();

// 预设材质和家具数据
const presetMaterials = {
  styles: [
    { id: 'modern', name: '现代简约', description: '简洁、实用的现代风格' },
    { id: 'classic', name: '经典欧式', description: '典雅、华丽的欧式风格' },
    { id: 'minimalist', name: '极简主义', description: '极简、留白的设计风格' },
    { id: 'industrial', name: '工业风格', description: '粗犷、原始的工业风格' },
    { id: 'scandinavian', name: '北欧风格', description: '自然、舒适的北欧风格' }
  ],
  materials: {
    modern: [
      { id: 'modern_wood', name: '原木色', color: '#D2B48C', texture: 'wood' },
      { id: 'modern_white', name: '纯白色', color: '#FFFFFF', texture: 'paint' },
      { id: 'modern_gray', name: '浅灰色', color: '#F0F0F0', texture: 'paint' }
    ],
    classic: [
      { id: 'classic_darkwood', name: '深色木', color: '#8B4513', texture: 'wood' },
      { id: 'classic_gold', name: '金色', color: '#FFD700', texture: 'metal' },
      { id: 'classic_cream', name: '奶油色', color: '#FFFDD0', texture: 'paint' }
    ],
    minimalist: [
      { id: 'minimalist_white', name: '纯白', color: '#FFFFFF', texture: 'paint' },
      { id: 'minimalist_black', name: '纯黑', color: '#000000', texture: 'paint' },
      { id: 'minimalist_gray', name: '深灰', color: '#333333', texture: 'paint' }
    ],
    industrial: [
      { id: 'industrial_metal', name: '金属色', color: '#C0C0C0', texture: 'metal' },
      { id: 'industrial_brick', name: '砖块', color: '#8B4513', texture: 'brick' },
      { id: 'industrial_concrete', name: '混凝土', color: '#A9A9A9', texture: 'concrete' }
    ],
    scandinavian: [
      { id: 'scandi_lightwood', name: '浅色木', color: '#F5DEB3', texture: 'wood' },
      { id: 'scandi_blue', name: '天蓝色', color: '#87CEEB', texture: 'paint' },
      { id: 'scandi_white', name: '白色', color: '#FFFFFF', texture: 'paint' }
    ]
  },
  layouts: [
    { id: 'default', name: '默认布局', description: '标准家具布局' },
    { id: 'open', name: '开放布局', description: '开放、通透的布局' },
    { id: 'cozy', name: '舒适布局', description: '温馨、舒适的布局' },
    { id: 'functional', name: '功能布局', description: '实用、功能优先的布局' }
  ]
};

// 获取所有风格
router.get('/styles', (req, res) => {
  res.json(presetMaterials.styles);
});

// 根据风格获取材质
router.get('/materials', (req, res) => {
  const { style } = req.query;
  if (!style) {
    return res.status(400).json({ error: '缺少风格参数' });
  }
  
  const materials = presetMaterials.materials[style] || [];
  res.json(materials);
});

// 获取所有布局
router.get('/layouts', (req, res) => {
  res.json(presetMaterials.layouts);
});

// 应用材质和家具更改
router.post('/apply', (req, res) => {
  const { style, materials, layout } = req.body;
  
  if (!style || !layout) {
    return res.status(400).json({ error: '缺少必要参数' });
  }
  
  // 模拟应用材质
  res.json({
    success: true,
    message: '材质应用成功',
    data: {
      style,
      materials,
      layout
    }
  });
});

module.exports = router;