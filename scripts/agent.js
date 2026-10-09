#!/usr/bin/env node

/**
 * 数据爬取代理服务
 * 提供API接口来触发AI Agent数据爬取和获取爬取状态
 */

import express from 'express';
import cors from 'cors';
import { scrapeAndUpdate as aiScrape } from './scraper-ai.js';
import fs from 'fs';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 3001;

const logFile = path.join(path.dirname(new URL(import.meta.url).pathname), '../logs/agent.log');

function ensureLogDirectory() {
  const logDir = path.dirname(logFile);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  console.log(logMessage);
  fs.appendFileSync(logFile, logMessage);
}

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/scrape', async (req, res) => {
  log('收到AI Agent爬取请求');
  try {
    await aiScrape();
    res.json({ success: true, message: 'AI Agent爬取任务已完成', timestamp: new Date().toISOString() });
  } catch (error) {
    log(`AI Agent爬取失败: ${error.message}`);
    res.status(500).json({ success: false, message: 'AI爬取任务执行失败', error: error.message });
  }
});

app.get('/status', (req, res) => {
  try {
    const aiLogFile = path.join(path.dirname(new URL(import.meta.url).pathname), '../logs/scraper-ai.log');

    const readRecentLogs = (filePath, lines = 10) => {
      if (fs.existsSync(filePath)) {
        const logs = fs.readFileSync(filePath, 'utf8');
        return logs.split('\n').filter(line => line.trim()).slice(-lines).join('\n');
      }
      return '暂无日志';
    };

    res.json({
      success: true,
      status: 'running',
      aiLogs: readRecentLogs(aiLogFile),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取状态失败', error: error.message });
  }
});

app.listen(PORT, () => {
  ensureLogDirectory();
  log(`代理服务已启动，监听端口 ${PORT}`);
  log(`健康检查: http://localhost:${PORT}/health`);
  log(`AI爬取:   POST http://localhost:${PORT}/scrape`);
  log(`爬取状态: GET  http://localhost:${PORT}/status`);
});

export default app;
