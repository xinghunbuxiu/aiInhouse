const express = require('express');
const { pool } = require('../config/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

const router = express.Router();

const defaultAiRuntimeConfig = {
  recognition: {
    mode: process.env.CODEX_RECOGNITION_MODE || 'ai_first',
    apiBaseUrl: process.env.CODEX_RECOGNITION_API_BASE_URL || '',
    apiModel: process.env.CODEX_RECOGNITION_API_MODEL || 'gpt-5.3-codex',
    preprocessCommand: process.env.CODEX_RECOGNITION_PREPROCESS_COMMAND || ''
  },
  rendering: {
    provider: process.env.CODEX_RENDER_PROVIDER || 'local_threejs',
    endpoint: process.env.CODEX_RENDER_ENDPOINT || '',
    apiKey: process.env.CODEX_RENDER_API_KEY || '',
    command: process.env.CODEX_RENDER_COMMAND || '',
    timeout: Number(process.env.CODEX_RENDER_TIMEOUT_MS || 10 * 60 * 1000)
  },
  panorama: {
    provider: process.env.CODEX_PANORAMA_PROVIDER || 'pannellum',
    endpoint: process.env.CODEX_PANORAMA_ENDPOINT || '',
    apiKey: process.env.CODEX_PANORAMA_API_KEY || '',
    command: process.env.CODEX_PANORAMA_COMMAND || '',
    timeout: Number(process.env.CODEX_PANORAMA_TIMEOUT_MS || 10 * 60 * 1000)
  }
};

function mergeRuntimeConfig(value = {}) {
  return {
    recognition: {
      ...defaultAiRuntimeConfig.recognition,
      ...(value.recognition || {})
    },
    rendering: {
      ...defaultAiRuntimeConfig.rendering,
      ...(value.rendering || {})
    },
    panorama: {
      ...defaultAiRuntimeConfig.panorama,
      ...(value.panorama || {})
    }
  };
}

async function readRuntimeConfig() {
  const [rows] = await pool.execute(
    'SELECT config_value FROM system_configs WHERE config_key = ? LIMIT 1',
    ['ai_runtime_config']
  );

  if (!rows.length || !rows[0].config_value) {
    return mergeRuntimeConfig();
  }

  try {
    return mergeRuntimeConfig(JSON.parse(rows[0].config_value));
  } catch (error) {
    return mergeRuntimeConfig();
  }
}

// 获取AI服务配置
router.get('/ai-service', authMiddleware, async (req, res) => {
  try {
    const [configs] = await pool.execute('SELECT * FROM ai_service_configs ORDER BY id DESC LIMIT 1');
    
    if (configs.length === 0) {
      return res.json({
        success: true,
        data: {
          parseService: 'local',
          openai: {
            apiKey: '',
            endpoint: 'https://api.openai.com/v1/chat/completions',
            model: 'gpt-4-turbo',
            timeout: 30000
          },
          localService: {
            endpoint: 'http://localhost:8000',
            timeout: 60000
          },
          runtime: await readRuntimeConfig()
        }
      });
    }

    const config = configs[0];
    res.json({
      success: true,
      data: {
        parseService: config.parse_service,
        openai: {
          apiKey: config.openai_api_key || '',
          endpoint: config.openai_endpoint,
          model: config.openai_model,
          timeout: config.openai_timeout
        },
        localService: {
          endpoint: config.local_service_endpoint,
          timeout: config.local_service_timeout
        },
        runtime: await readRuntimeConfig()
      }
    });
  } catch (error) {
    console.error('获取AI服务配置失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

// 更新AI服务配置（仅管理员）
router.put('/ai-service', authMiddleware, adminMiddleware, [
  body('parseService').isIn(['local', 'openai']).withMessage('解析服务类型必须是local或openai'),
  body('openai.apiKey').optional().isString(),
  body('openai.endpoint').optional().isURL(),
  body('openai.model').optional().isString(),
  body('openai.timeout').optional().isInt({ min: 1000 }),
  body('localService.endpoint').optional().isString(),
  body('localService.timeout').optional().isInt({ min: 1000 }),
  body('runtime').optional().isObject()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: '参数验证失败',
      errors: errors.array()
    });
  }

  const { parseService, openai, localService, runtime } = req.body;

  try {
    const [existingConfigs] = await pool.execute('SELECT id FROM ai_service_configs LIMIT 1');
    
    if (existingConfigs.length > 0) {
      await pool.execute(
        `UPDATE ai_service_configs SET 
          parse_service = ?,
          openai_api_key = ?,
          openai_endpoint = ?,
          openai_model = ?,
          openai_timeout = ?,
          local_service_endpoint = ?,
          local_service_timeout = ?,
          updated_at = NOW()
        WHERE id = ?`,
        [
          parseService,
          openai.apiKey,
          openai.endpoint,
          openai.model,
          openai.timeout,
          localService.endpoint,
          localService.timeout,
          existingConfigs[0].id
        ]
      );
    } else {
      await pool.execute(
        `INSERT INTO ai_service_configs 
          (parse_service, openai_api_key, openai_endpoint, openai_model, openai_timeout, local_service_endpoint, local_service_timeout)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          parseService,
          openai.apiKey,
          openai.endpoint,
          openai.model,
          openai.timeout,
          localService.endpoint,
          localService.timeout
        ]
      );
    }

    if (runtime) {
      const nextRuntimeConfig = mergeRuntimeConfig(runtime);
      await pool.execute(
        `INSERT INTO system_configs (config_key, config_value, description)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_at = NOW()`,
        [
          'ai_runtime_config',
          JSON.stringify(nextRuntimeConfig),
          'AI识别、3D渲染、全景VR供应商与命令配置'
        ]
      );
    }

    res.json({
      success: true,
      message: 'AI服务配置更新成功'
    });
  } catch (error) {
    console.error('更新AI服务配置失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

// 获取风格配置
router.get('/styles', authMiddleware, async (req, res) => {
  try {
    const [styles] = await pool.execute(
      'SELECT style_key, name, description FROM style_configs WHERE is_active = 1 ORDER BY sort_order'
    );
    
    const stylesMap = {};
    styles.forEach(style => {
      stylesMap[style.style_key] = {
        name: style.name,
        description: style.description
      };
    });

    res.json({
      success: true,
      data: stylesMap
    });
  } catch (error) {
    console.error('获取风格配置失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

// 获取所有风格配置（包括禁用的，仅管理员）
router.get('/styles/all', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [styles] = await pool.execute(
      'SELECT * FROM style_configs ORDER BY sort_order'
    );

    res.json({
      success: true,
      data: styles
    });
  } catch (error) {
    console.error('获取风格配置失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

// 创建风格配置（仅管理员）
router.post('/styles', authMiddleware, adminMiddleware, [
  body('styleKey').notEmpty().withMessage('风格标识不能为空'),
  body('name').notEmpty().withMessage('风格名称不能为空'),
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

  const { styleKey, name, description } = req.body;

  try {
    const [result] = await pool.execute(
      'INSERT INTO style_configs (style_key, name, description) VALUES (?, ?, ?)',
      [styleKey, name, description]
    );

    res.status(201).json({
      success: true,
      message: '风格配置创建成功',
      data: { id: result.insertId }
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({
        success: false,
        message: '风格标识已存在'
      });
    }
    console.error('创建风格配置失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

// 更新风格配置（仅管理员）
router.put('/styles/:id', authMiddleware, adminMiddleware, [
  body('name').optional().notEmpty(),
  body('description').optional().isString(),
  body('isActive').optional().isBoolean()
], async (req, res) => {
  const { id } = req.params;
  const { name, description, isActive } = req.body;

  try {
    const updates = [];
    const values = [];

    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      values.push(description);
    }
    if (isActive !== undefined) {
      updates.push('is_active = ?');
      values.push(isActive ? 1 : 0);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: '没有要更新的字段'
      });
    }

    values.push(id);
    await pool.execute(
      `UPDATE style_configs SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      values
    );

    res.json({
      success: true,
      message: '风格配置更新成功'
    });
  } catch (error) {
    console.error('更新风格配置失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

// 删除风格配置（仅管理员）
router.delete('/styles/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    await pool.execute('DELETE FROM style_configs WHERE id = ?', [id]);

    res.json({
      success: true,
      message: '风格配置删除成功'
    });
  } catch (error) {
    console.error('删除风格配置失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

// 获取提示模板配置
router.get('/prompts', authMiddleware, async (req, res) => {
  try {
    const [prompts] = await pool.execute(
      'SELECT prompt_key, prompt_content FROM prompt_configs WHERE is_active = 1'
    );
    
    const promptsMap = {};
    prompts.forEach(prompt => {
      promptsMap[prompt.prompt_key] = prompt.prompt_content;
    });

    res.json({
      success: true,
      data: promptsMap
    });
  } catch (error) {
    console.error('获取提示模板配置失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

// 获取所有提示模板配置（仅管理员）
router.get('/prompts/all', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [prompts] = await pool.execute('SELECT * FROM prompt_configs');

    res.json({
      success: true,
      data: prompts
    });
  } catch (error) {
    console.error('获取提示模板配置失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

// 更新提示模板配置（仅管理员）
router.put('/prompts/:promptKey', authMiddleware, adminMiddleware, [
  body('promptContent').notEmpty().withMessage('提示模板内容不能为空')
], async (req, res) => {
  const { promptKey } = req.params;
  const { promptContent } = req.body;

  try {
    await pool.execute(
      'UPDATE prompt_configs SET prompt_content = ?, updated_at = NOW() WHERE prompt_key = ?',
      [promptContent, promptKey]
    );

    res.json({
      success: true,
      message: '提示模板配置更新成功'
    });
  } catch (error) {
    console.error('更新提示模板配置失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

// 获取系统配置
router.get('/system', authMiddleware, async (req, res) => {
  try {
    const [configs] = await pool.execute('SELECT config_key, config_value FROM system_configs');
    
    const configMap = {};
    configs.forEach(config => {
      try {
        configMap[config.config_key] = JSON.parse(config.config_value);
      } catch {
        configMap[config.config_key] = config.config_value;
      }
    });

    res.json({
      success: true,
      data: configMap
    });
  } catch (error) {
    console.error('获取系统配置失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

// 更新系统配置（仅管理员）
router.put('/system/:configKey', authMiddleware, adminMiddleware, [
  body('configValue').notEmpty().withMessage('配置值不能为空')
], async (req, res) => {
  const { configKey } = req.params;
  const { configValue } = req.body;

  try {
    const [existingConfigs] = await pool.execute(
      'SELECT id FROM system_configs WHERE config_key = ?',
      [configKey]
    );

    const valueToStore = typeof configValue === 'object' 
      ? JSON.stringify(configValue) 
      : String(configValue);

    if (existingConfigs.length > 0) {
      await pool.execute(
        'UPDATE system_configs SET config_value = ?, updated_at = NOW() WHERE config_key = ?',
        [valueToStore, configKey]
      );
    } else {
      await pool.execute(
        'INSERT INTO system_configs (config_key, config_value) VALUES (?, ?)',
        [configKey, valueToStore]
      );
    }

    res.json({
      success: true,
      message: '系统配置更新成功'
    });
  } catch (error) {
    console.error('更新系统配置失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
});

module.exports = router;
