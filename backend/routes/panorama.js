const express = require('express');

const router = express.Router();

// 生成全景图
router.post('/generate', (req, res) => {
  const { sceneData } = req.body;
  
  if (!sceneData) {
    return res.status(400).json({ error: '缺少场景数据' });
  }
  
  // 模拟全景图生成
  const panoramaData = {
    success: true,
    panoramaUrl: 'https://pannellum.org/images/alma.jpg', // 使用示例图片
    thumbnailUrl: 'https://pannellum.org/images/alma.jpg',
    hotspots: [
      {
        id: '1',
        pitch: -5,
        yaw: 180,
        type: 'info',
        text: '客厅'
      },
      {
        id: '2',
        pitch: 0,
        yaw: 90,
        type: 'info',
        text: '卧室'
      },
      {
        id: '3',
        pitch: 0,
        yaw: 0,
        type: 'info',
        text: '厨房'
      }
    ]
  };
  
  res.json(panoramaData);
});

// 保存全景图
router.post('/save', (req, res) => {
  const { panoramaData } = req.body;
  
  if (!panoramaData) {
    return res.status(400).json({ error: '缺少全景图数据' });
  }
  
  // 模拟保存全景图
  res.json({
    success: true,
    message: '全景图保存成功',
    id: 'panorama-' + Date.now()
  });
});

// 分享全景图
router.get('/share/:id', (req, res) => {
  const { id } = req.params;
  
  if (!id) {
    return res.status(400).json({ error: '缺少全景图ID' });
  }
  
  // 模拟分享链接
  res.json({
    success: true,
    shareUrl: `https://example.com/panorama/${id}`
  });
});

module.exports = router;