const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

function resolveUploadsDir() {
  return path.resolve(__dirname, '..', process.env.UPLOAD_DIR || 'uploads');
}

function removeIfExists(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return;
  }

  fs.rmSync(targetPath, { recursive: true, force: true });
}

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '101.35.40.114',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '99f7b4d4dccad547',
    database: process.env.DB_NAME || 'aiinhouse',
    multipleStatements: true
  });

  const uploadsDir = resolveUploadsDir();

  try {
    await connection.beginTransaction();

    await connection.query('DELETE FROM ai_job_logs');
    await connection.query('DELETE FROM ai_jobs');
    await connection.query('DELETE FROM delivery_snapshots');
    await connection.query(`
      UPDATE floor_plans
      SET
        parse_status = 'pending',
        parse_result = NULL,
        panorama_url = NULL,
        latest_job_id = NULL,
        review_status = 'pending',
        review_notes = NULL,
        formal_plan_url = NULL,
        cad_file_url = NULL,
        formal_plan_json_url = NULL,
        three_d_config_url = NULL,
        panorama_config_url = NULL,
        review_file_url = NULL,
        preview_image_url = NULL,
        ai_processor = NULL,
        ai_processed_at = NULL
    `);
    await connection.query('DELETE FROM floor_plans');
    await connection.query('DELETE FROM ai_devices');

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }

  removeIfExists(path.join(uploadsDir, 'ai-results'));

  if (fs.existsSync(uploadsDir)) {
    for (const fileName of fs.readdirSync(uploadsDir)) {
      if (/^file-\d+/.test(fileName)) {
        removeIfExists(path.join(uploadsDir, fileName));
      }
    }
  }

  console.log('已清空平面图流程数据：floor_plans / ai_jobs / ai_job_logs / delivery_snapshots / ai_devices / uploads 产物');
  console.log('已保留基础资料：users / buildings / building_blocks / houses');
}

main().catch((error) => {
  console.error('清理流程数据失败:', error);
  process.exit(1);
});
