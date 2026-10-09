const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
require('dotenv').config();

const { testConnection, ensureDeliverySnapshotsTable, ensureAiInfrastructure } = require('./config/database');
const authRoutes = require('./routes/auth');
const configRoutes = require('./routes/config');
const userRoutes = require('./routes/users');
const buildingRoutes = require('./routes/buildings');
const buildingBlockRoutes = require('./routes/building-blocks');
const houseRoutes = require('./routes/houses');
const floorPlanRoutes = require('./routes/floor-plans');
const uploadRoutes = require('./routes/upload');
const aiRoutes = require('./routes/ai');
const aiJobRoutes = require('./routes/ai-jobs');
const aiDeviceRoutes = require('./routes/ai-devices');
const designAssetRoutes = require('./routes/design-assets');
const recognitionAssetRoutes = require('./routes/recognition-assets');

const app = express();
const PORT = process.env.PORT || 3000;
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174,http://tauri.localhost,tauri://localhost')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
const trustedProxyIps = ['127.0.0.1', '::1', '::ffff:127.0.0.1']

// 安全中间件
app.use(helmet());

// 限流配置
const limiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  max(req) {
    if (isTrustedLocalRequest(req)) {
      return 0
    }

    return Number(process.env.RATE_LIMIT_MAX || 600)
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip(req) {
    return isTrustedLocalRequest(req)
  },
  message: {
    success: false,
    message: '请求过于频繁，请稍后再试'
  }
});
app.use(limiter);

// CORS配置
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true)
      return
    }

    callback(new Error(`CORS blocked for origin: ${origin}`))
  },
  credentials: true
}));

// 日志中间件
app.use(morgan('dev'));

// 静态文件服务
app.use('/uploads', express.static('uploads'));
app.use(express.static('uploads'));
app.use('/ai-results', express.static('uploads/ai-results'));

// 解析JSON请求体
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 健康检查
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: '服务运行正常',
    timestamp: new Date().toISOString()
  });
});

// API路由
app.use('/api/auth', authRoutes);
app.use('/api/config', configRoutes);
app.use('/api/users', userRoutes);
app.use('/api/buildings', buildingRoutes);
app.use('/api/building-blocks', buildingBlockRoutes);
app.use('/api/houses', houseRoutes);
app.use('/api/floor-plans', floorPlanRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/ai-jobs', aiJobRoutes);
app.use('/api/ai-devices', aiDeviceRoutes);
app.use('/api/design-assets', designAssetRoutes);
app.use('/api/recognition-assets', recognitionAssetRoutes);

// 404处理
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: '接口不存在'
  });
});

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  res.status(500).json({
    success: false,
    message: '服务器内部错误',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 启动服务器
const startServer = async () => {
  // 测试数据库连接
  const dbConnected = await testConnection();
  
  if (!dbConnected) {
    console.error('数据库连接失败，服务器无法启动');
    process.exit(1);
  }

  await ensureDeliverySnapshotsTable();
  await ensureAiInfrastructure();

  app.listen(PORT, () => {
    console.log(`服务器运行在端口 ${PORT}`);
    console.log(`API地址: http://localhost:${PORT}`);
  });
};

startServer();

function isTrustedLocalRequest(req) {
  const forwardedFor = req.headers['x-forwarded-for']
  const candidates = [
    req.ip,
    req.socket?.remoteAddress,
    typeof forwardedFor === 'string' ? forwardedFor.split(',')[0].trim() : null
  ].filter(Boolean)

  return candidates.some((candidate) => trustedProxyIps.includes(candidate))
}
