const express = require('express');
const path = require('path');
const aiParseService = require('../services/aiParseService');

const router = express.Router();

// 平面图解析
router.post('/', async (req, res) => {
  const { filename } = req.body;
  
  if (!filename) {
    return res.status(400).json({ error: '缺少文件名' });
  }
  
  try {
    // 构建文件路径
    const filePath = path.join(__dirname, '../uploads', filename);
    
    // 使用AI解析服务解析平面图
    const parseResult = await aiParseService.parse(filePath);
    
    // 验证解析结果
    const validation = aiParseService.validateParseResult(parseResult);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }
    
    res.json(parseResult);
  } catch (error) {
    console.error('解析失败:', error);
    res.status(500).json({ error: '解析失败：' + error.message });
  }
});

module.exports = router;