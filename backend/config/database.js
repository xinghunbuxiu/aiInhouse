const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
  host: process.env.DB_HOST || '101.35.40.114',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '99f7b4d4dccad547',
  database: process.env.DB_NAME || 'aiinhouse',
  connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 10000),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
};

const pool = mysql.createPool(dbConfig);

async function executeWithRetry(sql, params = [], options = {}) {
  const {
    retries = Number(process.env.DB_QUERY_RETRIES || 1),
    retryDelayMs = Number(process.env.DB_QUERY_RETRY_DELAY_MS || 300),
    queryTimeoutMs = Number(process.env.DB_QUERY_TIMEOUT_MS || 8000)
  } = options;

  let attempt = 0;
  let lastError = null;

  while (attempt <= retries) {
    try {
      return await pool.query({
        sql,
        timeout: queryTimeoutMs
      }, params);
    } catch (error) {
      lastError = error;
      const retryable = ['ETIMEDOUT', 'ECONNRESET', 'PROTOCOL_CONNECTION_LOST', 'PROTOCOL_SEQUENCE_TIMEOUT'].includes(error.code);
      if (!retryable || attempt === retries) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
      attempt += 1;
    }
  }

  throw lastError;
}

const ensureColumn = async (tableName, columnName, definitionSql) => {
  try {
    const [rows] = await pool.execute(
      `SELECT COUNT(*) AS count
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [tableName, columnName]
    );

    if (Number(rows[0]?.count || 0) > 0) {
      return true;
    }

    await pool.execute(`ALTER TABLE ${tableName} ADD COLUMN ${definitionSql}`);
    return true;
  } catch (error) {
    console.error(`初始化列 ${tableName}.${columnName} 失败:`, error.message);
    return false;
  }
};

const ensureDeliverySnapshotsTable = async () => {
  const createTableSql = `
    CREATE TABLE IF NOT EXISTS delivery_snapshots (
      id INT PRIMARY KEY AUTO_INCREMENT,
      floor_plan_id INT NOT NULL COMMENT '平面图ID',
      version INT NOT NULL COMMENT '版本号',
      summary VARCHAR(255) COMMENT '版本摘要',
      source_type ENUM('digital', 'hand_drawn') DEFAULT 'digital' COMMENT '图纸来源',
      has_3d_config TINYINT DEFAULT 0 COMMENT '是否包含3D配置',
      has_panorama_config TINYINT DEFAULT 0 COMMENT '是否包含全景配置',
      room_count INT DEFAULT 0 COMMENT '房间数',
      hotspot_count INT DEFAULT 0 COMMENT '热点数',
      snapshot_data JSON NOT NULL COMMENT '快照完整数据',
      created_by INT COMMENT '创建人ID',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
      FOREIGN KEY (floor_plan_id) REFERENCES floor_plans(id) ON DELETE CASCADE,
      INDEX idx_floor_plan_id (floor_plan_id),
      INDEX idx_version (version),
      INDEX idx_created_at (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='平面图交付快照表'
  `;

  try {
    await pool.execute(createTableSql);
    console.log('交付快照表已就绪');
    return true;
  } catch (error) {
    console.error('初始化交付快照表失败:', error.message);
    return false;
  }
};

const ensureAiInfrastructure = async () => {
  const createAiDevicesSql = `
    CREATE TABLE IF NOT EXISTS ai_devices (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      device_code VARCHAR(64) NOT NULL UNIQUE,
      device_name VARCHAR(128) NOT NULL,
      device_type VARCHAR(32) NOT NULL DEFAULT 'desktop',
      processor_type VARCHAR(32) NOT NULL DEFAULT 'codex',
      os_name VARCHAR(64) DEFAULT NULL,
      os_version VARCHAR(64) DEFAULT NULL,
      app_version VARCHAR(32) DEFAULT NULL,
      owner_user_id BIGINT DEFAULT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'offline',
      capabilities_json JSON DEFAULT NULL,
      last_heartbeat_at DATETIME DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_ai_devices_owner_user_id (owner_user_id),
      INDEX idx_ai_devices_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI桌面设备表'
  `;

  const createAiJobsSql = `
    CREATE TABLE IF NOT EXISTS ai_jobs (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      job_no VARCHAR(64) NOT NULL UNIQUE,
      floor_plan_id BIGINT NOT NULL,
      house_id BIGINT DEFAULT NULL,
      job_type VARCHAR(32) NOT NULL,
      source_type VARCHAR(32) NOT NULL DEFAULT 'digital',
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      priority INT NOT NULL DEFAULT 50,
      created_by BIGINT DEFAULT NULL,
      assigned_device_id BIGINT DEFAULT NULL,
      assigned_user_id BIGINT DEFAULT NULL,
      input_payload JSON NOT NULL,
      result_payload JSON DEFAULT NULL,
      error_message TEXT DEFAULT NULL,
      retry_count INT NOT NULL DEFAULT 0,
      started_at DATETIME DEFAULT NULL,
      finished_at DATETIME DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_ai_jobs_floor_plan_id (floor_plan_id),
      INDEX idx_ai_jobs_house_id (house_id),
      INDEX idx_ai_jobs_status (status),
      INDEX idx_ai_jobs_job_type (job_type),
      INDEX idx_ai_jobs_assigned_device_id (assigned_device_id),
      INDEX idx_ai_jobs_created_by (created_by)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI处理任务表'
  `;

  const createAiJobLogsSql = `
    CREATE TABLE IF NOT EXISTS ai_job_logs (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      job_id BIGINT NOT NULL,
      stage VARCHAR(32) NOT NULL,
      level VARCHAR(16) NOT NULL DEFAULT 'info',
      message TEXT NOT NULL,
      payload JSON DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ai_job_logs_job_id (job_id),
      INDEX idx_ai_job_logs_stage (stage)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI任务日志表'
  `;

  try {
    await pool.execute(createAiDevicesSql);
    await pool.execute(createAiJobsSql);
    await pool.execute(createAiJobLogsSql);

    await ensureColumn('floor_plans', 'latest_job_id', 'latest_job_id BIGINT DEFAULT NULL');
    await ensureColumn('floor_plans', 'review_status', "review_status VARCHAR(32) DEFAULT 'pending'");
    await ensureColumn('floor_plans', 'review_notes', 'review_notes TEXT DEFAULT NULL');
    await ensureColumn('floor_plans', 'formal_plan_url', 'formal_plan_url VARCHAR(255) DEFAULT NULL');
    await ensureColumn('floor_plans', 'cad_file_url', 'cad_file_url VARCHAR(255) DEFAULT NULL');
    await ensureColumn('floor_plans', 'formal_plan_json_url', 'formal_plan_json_url VARCHAR(255) DEFAULT NULL');
    await ensureColumn('floor_plans', 'three_d_config_url', 'three_d_config_url VARCHAR(255) DEFAULT NULL');
    await ensureColumn('floor_plans', 'panorama_config_url', 'panorama_config_url VARCHAR(255) DEFAULT NULL');
    await ensureColumn('floor_plans', 'review_file_url', 'review_file_url VARCHAR(255) DEFAULT NULL');
    await ensureColumn('floor_plans', 'preview_image_url', 'preview_image_url VARCHAR(255) DEFAULT NULL');
    await ensureColumn('floor_plans', 'ai_processor', 'ai_processor VARCHAR(32) DEFAULT NULL');
    await ensureColumn('floor_plans', 'ai_processed_at', 'ai_processed_at DATETIME DEFAULT NULL');

    console.log('AI任务基础设施已就绪');
    return true;
  } catch (error) {
    console.error('初始化AI任务基础设施失败:', error.message);
    return false;
  }
};

const testConnection = async () => {
  try {
    const connection = await pool.getConnection();
    console.log('数据库连接成功！');
    connection.release();
    return true;
  } catch (error) {
    console.error('数据库连接失败:', error.message);
    return false;
  }
};

module.exports = {
  pool,
  executeWithRetry,
  testConnection,
  ensureDeliverySnapshotsTable,
  ensureAiInfrastructure
};
