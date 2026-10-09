const express = require('express');
const { pool } = require('../config/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

const router = express.Router();

// 获取楼栋列表（按楼盘）
router.get('/building/:buildingId', authMiddleware, async (req, res) => {
  const { buildingId } = req.params;

  try {
    const [blocks] = await pool.execute(
      'SELECT id, building_id, block_number, total_floors, total_units, description, status, created_at FROM building_blocks WHERE building_id = ? ORDER BY block_number',
      [buildingId]
    );

    res.json({
      success: true,
      data: blocks
    });
  } catch (error) {
    console.error('获取楼栋列表失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

// 获取楼栋详情
router.get('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    const [blocks] = await pool.execute(
      'SELECT * FROM building_blocks WHERE id = ?',
      [id]
    );

    if (blocks.length === 0) {
      return res.status(404).json({
        success: false,
        message: '楼栋不存在'
      });
    }

    res.json({
      success: true,
      data: blocks[0]
    });
  } catch (error) {
    console.error('获取楼栋详情失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

// 创建楼栋（仅管理员）
router.post('/', authMiddleware, adminMiddleware, [
  body('building_id').notEmpty().isInt().withMessage('楼盘ID不能为空'),
  body('block_number').notEmpty().withMessage('楼栋号不能为空'),
  body('total_floors').optional().isInt(),
  body('total_units').optional().isInt(),
  body('description').optional().isString()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: '参数验证失败',
      errors: errors.array()
    });
  }

  const { building_id, block_number, total_floors, total_units, description } = req.body;

  try {
    const [result] = await pool.execute(
      'INSERT INTO building_blocks (building_id, block_number, total_floors, total_units, description) VALUES (?, ?, ?, ?, ?)',
      [building_id, block_number, total_floors, total_units, description]
    );

    res.status(201).json({
      success: true,
      message: '楼栋创建成功',
      data: { id: result.insertId }
    });
  } catch (error) {
    console.error('创建楼栋失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

// 更新楼栋（仅管理员）
router.put('/:id', authMiddleware, adminMiddleware, [
  body('block_number').optional().notEmpty(),
  body('total_floors').optional().isInt(),
  body('total_units').optional().isInt(),
  body('description').optional().isString(),
  body('status').optional().isIn([0, 1])
], async (req, res) => {
  const { id } = req.params;
  const { block_number, total_floors, total_units, description, status } = req.body;

  try {
    const updates = [];
    const values = [];

    if (block_number !== undefined) {
      updates.push('block_number = ?');
      values.push(block_number);
    }
    if (total_floors !== undefined) {
      updates.push('total_floors = ?');
      values.push(total_floors);
    }
    if (total_units !== undefined) {
      updates.push('total_units = ?');
      values.push(total_units);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      values.push(description);
    }
    if (status !== undefined) {
      updates.push('status = ?');
      values.push(status);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: '没有要更新的字段'
      });
    }

    values.push(id);
    await pool.execute(
      `UPDATE building_blocks SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      values
    );

    res.json({
      success: true,
      message: '楼栋更新成功'
    });
  } catch (error) {
    console.error('更新楼栋失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

// 删除楼栋（仅管理员）
router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    // 检查是否有房屋关联
    const [houses] = await pool.execute('SELECT id FROM houses WHERE block_id = ?', [id]);
    if (houses.length > 0) {
      return res.status(400).json({
        success: false,
        message: '该楼栋下有房屋，无法删除'
      });
    }

    await pool.execute('DELETE FROM building_blocks WHERE id = ?', [id]);

    res.json({
      success: true,
      message: '楼栋删除成功'
    });
  } catch (error) {
    console.error('删除楼栋失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

module.exports = router;