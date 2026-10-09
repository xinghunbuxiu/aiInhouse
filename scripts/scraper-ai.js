#!/usr/bin/env node

/**
 * AI Agent 楼盘数据爬取脚本
 * 通过豆包/元宝大模型直接提问获取楼盘信息，返回固定JSON格式入库
 * 
 * 免费额度：
 *   - 火山引擎豆包：新用户5000万Token免费，每日200万Token刷新
 *   - 完全兼容OpenAI接口
 */

import fs from 'fs';
import path from 'path';
import axios from 'axios';
import mysql from 'mysql2/promise';
import cron from 'node-cron';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);

const config = {
  database: {
    host: '101.35.40.114',
    user: 'root',
    password: '99f7b4d4dccad547',
    database: 'aiinhouse'
  },
  ai: {
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey: 'de1ba494-dbac-435c-8312-217b77ca76e8',
    model: 'doubao-seed-2-0-lite-260215'
  },
  scraping: {
    interval: '0 2 * * *'
  },
  logFile: path.join(__dirname, '../logs/scraper-ai.log')
};

function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  console.log(logMessage);
  const logDir = path.dirname(config.logFile);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  fs.appendFileSync(config.logFile, logMessage);
}

const PROMPT_TEMPLATE = `你是一个房产数据助手。请根据我的问题，返回真实准确的楼盘信息。

要求：
1. 只返回JSON数组，不要任何其他文字
2. 每个楼盘包含以下字段：
   - name: 楼盘名称（字符串）
   - address: 详细地址（字符串，包含省市区）
   - developer: 开发商名称（字符串）
   - status: 销售状态，只能是 "在售" 或 "待售"（字符串）
   - description: 楼盘简介50字以内（字符串）
3. 数据必须真实准确，不要编造
4. 如果某个字段信息不确定，填空字符串

我的问题是：{query}

请返回JSON数组：`;

const QUERIES = [
  '忻州市忻府区目前在售和待售的楼盘有哪些？请列出所有你知道的，包括楼盘名称、地址、开发商、销售状态和简介。',
  '忻州市忻府区2024年-2025年新开盘的楼盘有哪些？请列出楼盘名称、地址、开发商和简介。',
  '忻州市忻府区有哪些知名开发商的楼盘项目？比如恒大、碧桂园、万科、保利等，请列出名称、地址和状态。',
  '忻州市忻府区城南片区、城北片区、城东片区各有哪些楼盘？请列出名称、地址、开发商和状态。',
  '忻州市忻府区有哪些改善型住宅楼盘？面积100平米以上的，请列出名称、地址、开发商和简介。'
];

async function callDoubao(prompt) {
  log(`调用豆包API...`);
  try {
    const systemPrompt = '你是一个专业的房产数据助手，只返回JSON格式数据，不要返回任何其他内容。';
    const fullPrompt = `${systemPrompt}\n\n${prompt}`;

    const response = await axios.post(
      `${config.ai.baseUrl}/responses`,
      {
        model: config.ai.model,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: fullPrompt }
            ]
          }
        ],
        thinking: { type: 'disabled' }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.ai.apiKey}`
        },
        timeout: 60000
      }
    );

    const output = response.data.output;
    let content = '';
    if (Array.isArray(output)) {
      content = output[0]?.content?.[0]?.text || '';
    } else if (output?.content) {
      content = Array.isArray(output.content) ? output.content[0]?.text || '' : output.content;
    }
    content = typeof content === 'string' ? content.trim() : JSON.stringify(content);
    log(`豆包API返回内容: ${content}`);
    log(`豆包API返回内容长度: ${content.length} 字符`);

    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    log(`无法从返回内容中提取JSON数组`);
    return [];
  } catch (error) {
    log(`豆包API调用失败: ${error.message}`);
    if (error.response) {
      log(`HTTP状态码: ${error.response.status}`);
      log(`错误详情: ${JSON.stringify(error.response.data)}`);
    }
    return [];
  }
}

async function fetchAllBuildings() {
  const allBuildings = [];

  for (let i = 0; i < QUERIES.length; i++) {
    log(`执行第 ${i + 1}/${QUERIES.length} 个查询...`);
    const prompt = PROMPT_TEMPLATE.replace('{query}', QUERIES[i]);
    const buildings = await callDoubao(prompt);
    log(`第 ${i + 1} 个查询获取了 ${buildings.length} 个楼盘`);
    allBuildings.push(...buildings);
  }

  return deduplicateBuildings(allBuildings);
}

function deduplicateBuildings(buildings) {
  const unique = [];
  const seen = new Set();
  for (const b of buildings) {
    if (b.name && !seen.has(b.name)) {
      seen.add(b.name);
      unique.push(b);
    }
  }
  log(`去重后剩余 ${unique.length} 个楼盘`);
  return unique;
}

async function connectDatabase() {
  try {
    const connection = await mysql.createConnection(config.database);
    log('数据库连接成功');
    return connection;
  } catch (error) {
    log(`数据库连接失败: ${error.message}`);
    throw error;
  }
}

function mapStatus(status) {
  const map = { '在售': 1, '待售': 2, '已售': 3, '尾盘': 4 };
  return map[status] || 1;
}

async function upsertBuildings(connection, buildings) {
  log('开始插入或更新楼盘数据...');

  let inserted = 0;
  let updated = 0;

  for (const building of buildings) {
    try {
      const [existing] = await connection.execute(
        'SELECT id FROM buildings WHERE name = ?',
        [building.name]
      );

      const statusInt = mapStatus(building.status || '在售');
      const address = building.address || '';
      const developer = building.developer || '';
      const description = building.description || '';

      if (existing.length > 0) {
        await connection.execute(
          'UPDATE buildings SET address = ?, developer = ?, status = ?, description = ?, updated_at = NOW() WHERE id = ?',
          [address, developer, statusInt, description, existing[0].id]
        );
        updated++;
        log(`更新楼盘: ${building.name}`);
      } else {
        await connection.execute(
          'INSERT INTO buildings (name, address, developer, status, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())',
          [building.name, address, developer, statusInt, description]
        );
        inserted++;
        log(`插入新楼盘: ${building.name}`);
      }
    } catch (error) {
      log(`处理楼盘 ${building.name} 失败: ${error.message}`);
    }
  }

  log(`数据入库完成: 新增 ${inserted} 个, 更新 ${updated} 个`);
}

async function scrapeAndUpdate() {
  log('====================================');
  log('开始执行AI Agent数据爬取任务');

  try {
    const buildings = await fetchAllBuildings();

    if (buildings.length > 0) {
      const connection = await connectDatabase();
      await upsertBuildings(connection, buildings);
      await connection.end();
      log('数据库连接已关闭');
    } else {
      log('未获取到新的楼盘数据');
    }

    log('数据爬取任务执行完成');
  } catch (error) {
    log(`数据爬取任务失败: ${error.message}`);
  }

  log('====================================');
}

function startCronJob() {
  log(`设置定时任务，执行间隔: ${config.scraping.interval}`);
  cron.schedule(config.scraping.interval, () => {
    scrapeAndUpdate();
  });
  log('定时任务已启动');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  scrapeAndUpdate();
  startCronJob();
  log('AI Agent爬虫服务已启动，按 Ctrl+C 停止');
}

export { scrapeAndUpdate, startCronJob };
