const express = require('express');
const { pool } = require('../config/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

const router = express.Router();

async function queryHousesWithCompatibility(baseQuery, values) {
  try {
    const [houses] = await pool.execute(baseQuery, values);
    return houses;
  } catch (error) {
    if (error.code !== 'ER_BAD_FIELD_ERROR') {
      throw error;
    }

    const fallbackQuery = baseQuery
      .replace('bb.block_number, ', '')
      .replace(', bb.block_number', '')
      .replace(', h.block_id', '')
      .replace('h.block_id, ', '')
      .replace(' LEFT JOIN building_blocks bb ON h.block_id = bb.id', '')
      .replace(' AND h.block_id = ?', '')
      .replace(' ORDER BY b.name ASC, bb.block_number ASC, h.floor_number DESC, h.unit_number ASC, h.room_number ASC, h.created_at DESC', ' ORDER BY b.name ASC, h.floor_number DESC, h.unit_number ASC, h.room_number ASC, h.created_at DESC');

    const [houses] = await pool.execute(fallbackQuery, values);
    return houses.map((house) => ({
      ...house,
      block_id: null,
      block_number: null
    }));
  }
}

// 获取房屋列表
router.get('/', authMiddleware, async (req, res) => {
  const { building_id, block_id, floor_number, status } = req.query;
  let query = 'SELECT h.*, b.name as building_name, bb.block_number FROM houses h LEFT JOIN buildings b ON h.building_id = b.id LEFT JOIN building_blocks bb ON h.block_id = bb.id WHERE 1=1';
  const values = [];

  if (building_id) {
    query += ' AND h.building_id = ?';
    values.push(building_id);
  }
  if (block_id) {
    query += ' AND h.block_id = ?';
    values.push(block_id);
  }
  if (floor_number) {
    query += ' AND h.floor_number = ?';
    values.push(floor_number);
  }
  if (status) {
    query += ' AND h.status = ?';
    values.push(status);
  }

  query += ' ORDER BY b.name ASC, bb.block_number ASC, h.floor_number DESC, h.unit_number ASC, h.room_number ASC, h.created_at DESC';

  try {
    const houses = await queryHousesWithCompatibility(query, values);

    res.json({
      success: true,
      data: houses
    });
  } catch (error) {
    console.error('获取房屋列表失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

// 获取房屋详情
router.get('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    const houses = await queryHousesWithCompatibility(
      'SELECT h.*, b.name as building_name, bb.block_number FROM houses h LEFT JOIN buildings b ON h.building_id = b.id LEFT JOIN building_blocks bb ON h.block_id = bb.id WHERE h.id = ?',
      [id]
    );

    if (houses.length === 0) {
      return res.status(404).json({
        success: false,
        message: '房屋不存在'
      });
    }

    res.json({
      success: true,
      data: houses[0]
    });
  } catch (error) {
    console.error('获取房屋详情失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

// 创建房屋（仅管理员）
router.post('/', authMiddleware, adminMiddleware, [
  body('building_id').notEmpty().withMessage('楼盘ID不能为空'),
  body('block_id').optional(),
  body('unit_number').notEmpty().withMessage('单元号不能为空'),
  body('floor_number').optional().isInt(),
  body('room_number').optional().isString(),
  body('area').optional().isDecimal(),
  body('room_count').optional().isInt(),
  body('layout').optional().isString(),
  body('status').optional().isIn(['available', 'sold', 'reserved'])
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: '参数验证失败',
      errors: errors.array()
    });
  }

  const { building_id, block_id, unit_number, floor_number, room_number, area, room_count, layout, status, description } = req.body;

  try {
    const [blockIdColumns] = await pool.execute(
      `SELECT COUNT(*) AS count
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'houses' AND COLUMN_NAME = 'block_id'`
    );
    const hasBlockIdColumn = Number(blockIdColumns[0]?.count || 0) > 0;

    // 检查楼盘是否存在
    const [buildings] = await pool.execute('SELECT id FROM buildings WHERE id = ? AND status = 1', [building_id]);
    if (buildings.length === 0) {
      return res.status(400).json({
        success: false,
        message: '楼盘不存在或已禁用'
      });
    }

    if (hasBlockIdColumn) {
      const [blocks] = await pool.execute('SELECT id FROM building_blocks WHERE id = ? AND building_id = ? AND status = 1', [block_id, building_id]);
      if (blocks.length === 0) {
        return res.status(400).json({
          success: false,
          message: '楼栋不存在、未启用，或与楼盘不匹配'
        });
      }
    }

    const [result] = hasBlockIdColumn
      ? await pool.execute(
          'INSERT INTO houses (building_id, block_id, unit_number, floor_number, room_number, area, room_count, layout, status, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [building_id, block_id ?? null, unit_number, floor_number ?? null, room_number ?? null, area ?? null, room_count ?? null, layout ?? null, status || 'available', description ?? null]
        )
      : await pool.execute(
          'INSERT INTO houses (building_id, unit_number, floor_number, room_number, area, room_count, layout, status, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [building_id, unit_number, floor_number ?? null, room_number ?? null, area ?? null, room_count ?? null, layout ?? null, status || 'available', description ?? null]
        );

    res.status(201).json({
      success: true,
      message: '房屋创建成功',
      data: { id: result.insertId }
    });
  } catch (error) {
    console.error('创建房屋失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

// 更新房屋（仅管理员）
router.put('/:id', authMiddleware, adminMiddleware, [
  body('building_id').optional().notEmpty(),
  body('block_id').optional(),
  body('unit_number').optional().notEmpty(),
  body('floor_number').optional().isInt(),
  body('room_number').optional().isString(),
  body('area').optional().isDecimal(),
  body('room_count').optional().isInt(),
  body('layout').optional().isString(),
  body('status').optional().isIn(['available', 'sold', 'reserved']),
  body('description').optional().isString()
], async (req, res) => {
  const { id } = req.params;
  const { building_id, block_id, unit_number, floor_number, room_number, area, room_count, layout, status, description } = req.body;

  try {
    const [blockIdColumns] = await pool.execute(
      `SELECT COUNT(*) AS count
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'houses' AND COLUMN_NAME = 'block_id'`
    );
    const hasBlockIdColumn = Number(blockIdColumns[0]?.count || 0) > 0;

    const updates = [];
    const values = [];

    let resolvedBuildingId = building_id;

    if (building_id !== undefined) {
      // 检查楼盘是否存在
      const [buildings] = await pool.execute('SELECT id FROM buildings WHERE id = ? AND status = 1', [building_id]);
      if (buildings.length === 0) {
        return res.status(400).json({
          success: false,
          message: '楼盘不存在或已禁用'
        });
      }
      updates.push('building_id = ?');
      values.push(building_id);
    }

    if (resolvedBuildingId === undefined && block_id !== undefined && hasBlockIdColumn) {
      const [currentRows] = await pool.execute('SELECT building_id FROM houses WHERE id = ?', [id]);
      resolvedBuildingId = currentRows[0]?.building_id;
    }

    if (block_id !== undefined && hasBlockIdColumn) {
      const [blocks] = await pool.execute('SELECT id FROM building_blocks WHERE id = ? AND building_id = ? AND status = 1', [block_id, resolvedBuildingId]);
      if (blocks.length === 0) {
        return res.status(400).json({
          success: false,
          message: '楼栋不存在、未启用，或与楼盘不匹配'
        });
      }
      updates.push('block_id = ?');
      values.push(block_id);
    }
    if (unit_number !== undefined) {
      updates.push('unit_number = ?');
      values.push(unit_number);
    }
    if (floor_number !== undefined) {
      updates.push('floor_number = ?');
      values.push(floor_number);
    }
    if (room_number !== undefined) {
      updates.push('room_number = ?');
      values.push(room_number);
    }
    if (area !== undefined) {
      updates.push('area = ?');
      values.push(area);
    }
    if (room_count !== undefined) {
      updates.push('room_count = ?');
      values.push(room_count);
    }
    if (layout !== undefined) {
      updates.push('layout = ?');
      values.push(layout);
    }
    if (status !== undefined) {
      updates.push('status = ?');
      values.push(status);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      values.push(description);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: '没有要更新的字段'
      });
    }

    values.push(id);
    await pool.execute(
      `UPDATE houses SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      values
    );

    res.json({
      success: true,
      message: '房屋更新成功'
    });
  } catch (error) {
    console.error('更新房屋失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

// 删除房屋（仅管理员）
router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    // 检查是否有平面图关联
    const [floorPlans] = await pool.execute('SELECT id FROM floor_plans WHERE house_id = ?', [id]);
    if (floorPlans.length > 0) {
      return res.status(400).json({
        success: false,
        message: '该房屋下有平面图，无法删除'
      });
    }

    await pool.execute('DELETE FROM houses WHERE id = ?', [id]);

    res.json({
      success: true,
      message: '房屋删除成功'
    });
  } catch (error) {
    console.error('删除房屋失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

module.exports = router;
