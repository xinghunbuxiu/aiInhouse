const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function main() {
  const schemaPath = path.resolve(__dirname, '../../database/schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '101.35.40.114',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '99f7b4d4dccad547',
    database: process.env.DB_NAME || 'aiinhouse',
    multipleStatements: true
  });

  try {
    await connection.query(schemaSql);
    console.log(`数据库初始化完成: ${schemaPath}`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('数据库初始化失败:', error);
  process.exit(1);
});
