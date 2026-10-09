const express = require('express');
const storageService = require('../services/storageService');

const router = express.Router();

// 保存设计方案
router.post('/save', async (req, res) => {
  const { userId, designData } = req.body;
  
  if (!userId || !designData) {
    return res.status(400).json({ error: '缺少必要参数' });
  }
  
  const designId = 'design-' + Date.now();
  const design = {
    id: designId,
    userId,
    ...designData,
    createdAt: new Date().toISOString()
  };
  
  const result = await storageService.saveDesign(designId, design);
  if (result.success) {
    res.json({ success: true, message: '设计方案保存成功', designId });
  } else {
    res.status(500).json({ error: result.error });
  }
});

// 获取设计方案
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  
  if (!id) {
    return res.status(400).json({ error: '缺少设计方案ID' });
  }
  
  const result = await storageService.getDesign(id);
  if (result.success) {
    res.json({ success: true, data: result.data });
  } else {
    res.status(404).json({ error: result.error });
  }
});

// 获取用户的所有设计方案
router.get('/user/:userId', async (req, res) => {
  const { userId } = req.params;
  
  if (!userId) {
    return res.status(400).json({ error: '缺少用户ID' });
  }
  
  const result = await storageService.getUserDesigns(userId);
  if (result.success) {
    res.json({ success: true, data: result.data });
  } else {
    res.status(500).json({ error: result.error });
  }
});

// 删除设计方案
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  
  if (!id) {
    return res.status(400).json({ error: '缺少设计方案ID' });
  }
  
  const result = await storageService.deleteDesign(id);
  if (result.success) {
    res.json({ success: true, message: '设计方案删除成功' });
  } else {
    res.status(404).json({ error: result.error });
  }
});

module.exports = router;