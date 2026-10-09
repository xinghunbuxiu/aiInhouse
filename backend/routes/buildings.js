const express = require('express');
const { pool } = require('../config/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

const router = express.Router();

// 获取楼盘列表
router.get('/', authMiddleware, async (req, res) => {
  try {
    const [buildings] = await pool.execute(
      'SELECT id, name, address, developer, cover_image, status, created_at FROM buildings WHERE status = 1 ORDER BY created_at DESC'
    );

    res.json({
      success: true,
      data: buildings
    });
  } catch (error) {
    console.error('获取楼盘列表失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

// 获取所有楼盘（包括禁用的，仅管理员）
router.get('/all', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [buildings] = await pool.execute(
      'SELECT * FROM buildings ORDER BY created_at DESC'
    );

    res.json({
      success: true,
      data: buildings
    });
  } catch (error) {
    console.error('获取所有楼盘失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

// 获取楼盘详情
router.get('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    const [buildings] = await pool.execute(
      'SELECT * FROM buildings WHERE id = ?',
      [id]
    );

    if (buildings.length === 0) {
      return res.status(404).json({
        success: false,
        message: '楼盘不存在'
      });
    }

    res.json({
      success: true,
      data: buildings[0]
    });
  } catch (error) {
    console.error('获取楼盘详情失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

// 创建楼盘（仅管理员）
router.post('/', authMiddleware, adminMiddleware, [
  body('name').notEmpty().withMessage('楼盘名称不能为空'),
  body('address').optional().isString(),
  body('developer').optional().isString(),
  body('description').optional().isString(),
  body('cover_image').optional().isString()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: '参数验证失败',
      errors: errors.array()
    });
  }

  const { name, address, developer, description, cover_image } = req.body;

  try {
    const [result] = await pool.execute(
      'INSERT INTO buildings (name, address, developer, description, cover_image, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [name, address ?? null, developer ?? null, description ?? null, cover_image ?? null, req.user.id]
    );

    res.status(201).json({
      success: true,
      message: '楼盘创建成功',
      data: { id: result.insertId }
    });
  } catch (error) {
    console.error('创建楼盘失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

// 更新楼盘（仅管理员）
router.put('/:id', authMiddleware, adminMiddleware, [
  body('name').optional().notEmpty(),
  body('address').optional().isString(),
  body('developer').optional().isString(),
  body('description').optional().isString(),
  body('cover_image').optional().isString(),
  body('status').optional().isIn([0, 1])
], async (req, res) => {
  const { id } = req.params;
  const { name, address, developer, description, cover_image, status } = req.body;

  try {
    const updates = [];
    const values = [];

    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }
    if (address !== undefined) {
      updates.push('address = ?');
      values.push(address);
    }
    if (developer !== undefined) {
      updates.push('developer = ?');
      values.push(developer);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      values.push(description);
    }
    if (cover_image !== undefined) {
      updates.push('cover_image = ?');
      values.push(cover_image);
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
      `UPDATE buildings SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      values
    );

    res.json({
      success: true,
      message: '楼盘更新成功'
    });
  } catch (error) {
    console.error('更新楼盘失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

// 删除楼盘（仅管理员）
router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    // 检查是否有房屋关联
    const [houses] = await pool.execute('SELECT id FROM houses WHERE building_id = ?', [id]);
    if (houses.length > 0) {
      return res.status(400).json({
        success: false,
        message: '该楼盘下有房屋，无法删除'
      });
    }

    await pool.execute('DELETE FROM buildings WHERE id = ?', [id]);

    res.json({
      success: true,
      message: '楼盘删除成功'
    });
  } catch (error) {
    console.error('删除楼盘失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

module.exports = router;
