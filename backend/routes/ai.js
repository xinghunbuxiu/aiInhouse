const express = require('express');
const aiService = require('../services/aiService');
const { authMiddleware } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

const router = express.Router();

// 解析平面图
router.post('/parse-floor-plan', authMiddleware, [
  body('imageUrl').notEmpty().withMessage('平面图图片URL不能为空'),
  body('prompt').optional().isString()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: '参数验证失败',
      errors: errors.array()
    });
  }

  const { imageUrl, prompt } = req.body;

  try {
    const result = await aiService.parseFloorPlan(imageUrl, prompt);
    
    res.json({
      success: true,
      message: '平面图解析成功',
      data: result
    });
  } catch (error) {
    console.error('解析平面图失败:', error);
    res.status(500).json({
      success: false,
      message: '解析平面图失败',
      error: error.message
    });
  }
});

// 生成3D场景配置
router.post('/generate-3d-config', authMiddleware, [
  body('parseData').notEmpty().withMessage('解析数据不能为空'),
  body('style').optional().isString()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: '参数验证失败',
      errors: errors.array()
    });
  }

  const { parseData, style } = req.body;

  try {
    const result = await aiService.generate3DConfig(parseData, style);
    
    res.json({
      success: true,
      message: '3D场景配置生成成功',
      data: result
    });
  } catch (error) {
    console.error('生成3D场景配置失败:', error);
    res.status(500).json({
      success: false,
      message: '生成3D场景配置失败',
      error: error.message
    });
  }
});

// 生成全景图配置
router.post('/generate-panorama-config', authMiddleware, [
  body('sceneData').notEmpty().withMessage('3D场景数据不能为空')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: '参数验证失败',
      errors: errors.array()
    });
  }

  const { sceneData } = req.body;

  try {
    const result = await aiService.generatePanoramaConfig(sceneData);
    
    res.json({
      success: true,
      message: '全景图配置生成成功',
      data: result
    });
  } catch (error) {
    console.error('生成全景图配置失败:', error);
    res.status(500).json({
      success: false,
      message: '生成全景图配置失败',
      error: error.message
    });
  }
});

// 批量处理平面图
router.post('/batch-process', authMiddleware, [
  body('floorPlans').isArray().withMessage('平面图列表必须是数组'),
  body('floorPlans.*.imageUrl').notEmpty().withMessage('每个平面图必须有图片URL'),
  body('floorPlans.*.id').optional().isInt().withMessage('平面图ID必须是整数')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: '参数验证失败',
      errors: errors.array()
    });
  }

  const { floorPlans } = req.body;

  try {
    const results = [];
    
    for (const plan of floorPlans) {
      try {
        const parseResult = await aiService.parseFloorPlan(plan.imageUrl);
        const config3D = await aiService.generate3DConfig(parseResult);
        const panoramaConfig = await aiService.generatePanoramaConfig(config3D);
        
        results.push({
          id: plan.id,
          imageUrl: plan.imageUrl,
          parseResult,
          config3D,
          panoramaConfig,
          status: 'success'
        });
      } catch (error) {
        results.push({
          id: plan.id,
          imageUrl: plan.imageUrl,
          status: 'error',
          error: error.message
        });
      }
    }
    
    res.json({
      success: true,
      message: '批量处理完成',
      data: results
    });
  } catch (error) {
    console.error('批量处理失败:', error);
    res.status(500).json({
      success: false,
      message: '批量处理失败',
      error: error.message
    });
  }
});

module.exports = router;