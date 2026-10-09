const express = require('express');
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.post('/register', authMiddleware, async (req, res) => {
  const {
    device_code,
    device_name,
    device_type,
    processor_type,
    os_name,
    os_version,
    app_version,
    capabilities_json
  } = req.body;

  if (!device_code || !device_name) {
    return res.status(400).json({
      success: false,
      message: '设备编码和设备名称不能为空'
    });
  }

  try {
    await pool.execute(
      `INSERT INTO ai_devices
      (device_code, device_name, device_type, processor_type, os_name, os_version, app_version, owner_user_id, status, capabilities_json, last_heartbeat_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'online', ?, NOW())
      ON DUPLICATE KEY UPDATE
        device_name = VALUES(device_name),
        device_type = VALUES(device_type),
        processor_type = VALUES(processor_type),
        os_name = VALUES(os_name),
        os_version = VALUES(os_version),
        app_version = VALUES(app_version),
        owner_user_id = VALUES(owner_user_id),
        status = 'online',
        capabilities_json = VALUES(capabilities_json),
        last_heartbeat_at = NOW(),
        updated_at = NOW()`,
      [
        device_code,
        device_name,
        device_type || 'desktop',
        processor_type || 'codex',
        os_name || null,
        os_version || null,
        app_version || null,
        req.user.id,
        capabilities_json ? JSON.stringify(capabilities_json) : null
      ]
    );

    res.json({
      success: true,
      message: '设备注册成功'
    });
  } catch (error) {
    console.error('注册AI设备失败:', error);
    res.status(500).json({
      success: false,
      message: '注册AI设备失败'
    });
  }
});

router.post('/heartbeat', authMiddleware, async (req, res) => {
  const { device_code, status } = req.body;

  if (!device_code) {
    return res.status(400).json({
      success: false,
      message: '设备编码不能为空'
    });
  }

  try {
    await pool.execute(
      'UPDATE ai_devices SET status = ?, last_heartbeat_at = NOW(), updated_at = NOW() WHERE device_code = ?',
      [status || 'online', device_code]
    );

    res.json({
      success: true,
      message: '设备心跳更新成功'
    });
  } catch (error) {
    console.error('更新AI设备心跳失败:', error);
    res.status(500).json({
      success: false,
      message: '更新AI设备心跳失败'
    });
  }
});

router.get('/', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM ai_devices ORDER BY updated_at DESC');
    res.json({
      success: true,
      data: rows
    });
  } catch (error) {
    console.error('获取AI设备列表失败:', error);
    res.status(500).json({
      success: false,
      message: '获取AI设备列表失败'
    });
  }
});

module.exports = router;
