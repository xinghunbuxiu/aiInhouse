-- AIInHouse 数据库表结构
-- 一键导入脚本

-- 创建数据库
CREATE DATABASE IF NOT EXISTS aiinhouse CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE aiinhouse;

-- ============================================
-- 用户表
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(50) NOT NULL UNIQUE COMMENT '用户名',
    password VARCHAR(255) NOT NULL COMMENT '密码（加密存储）',
    email VARCHAR(100) UNIQUE COMMENT '邮箱',
    phone VARCHAR(20) COMMENT '手机号',
    role ENUM('admin', 'user') DEFAULT 'user' COMMENT '角色：admin-管理员，user-普通用户',
    status TINYINT DEFAULT 1 COMMENT '状态：0-禁用，1-启用',
    avatar VARCHAR(255) COMMENT '头像URL',
    last_login_at TIMESTAMP NULL COMMENT '最后登录时间',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    INDEX idx_username (username),
    INDEX idx_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户表';

-- ============================================
-- 系统配置表
-- ============================================
CREATE TABLE IF NOT EXISTS system_configs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    config_key VARCHAR(100) NOT NULL UNIQUE COMMENT '配置键',
    config_value TEXT COMMENT '配置值（JSON格式）',
    description VARCHAR(255) COMMENT '配置描述',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_config_key (config_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='系统配置表';

-- ============================================
-- AI服务配置表
-- ============================================
CREATE TABLE IF NOT EXISTS ai_service_configs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    parse_service ENUM('local', 'openai') DEFAULT 'local' COMMENT '解析服务类型',
    openai_api_key VARCHAR(255) COMMENT 'OpenAI API Key（加密存储）',
    openai_endpoint VARCHAR(255) DEFAULT 'https://api.openai.com/v1/chat/completions' COMMENT 'OpenAI API地址',
    openai_model VARCHAR(50) DEFAULT 'gpt-4-turbo' COMMENT 'OpenAI模型',
    openai_timeout INT DEFAULT 30000 COMMENT 'OpenAI超时时间（毫秒）',
    local_service_endpoint VARCHAR(255) DEFAULT 'http://localhost:8000' COMMENT '本地AI服务地址',
    local_service_timeout INT DEFAULT 60000 COMMENT '本地AI服务超时时间（毫秒）',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI服务配置表';

-- ============================================
-- 风格配置表
-- ============================================
CREATE TABLE IF NOT EXISTS style_configs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    style_key VARCHAR(50) NOT NULL UNIQUE COMMENT '风格标识',
    name VARCHAR(100) NOT NULL COMMENT '风格名称',
    description TEXT COMMENT '风格描述',
    sort_order INT DEFAULT 0 COMMENT '排序',
    is_active TINYINT DEFAULT 1 COMMENT '是否启用：0-禁用，1-启用',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_style_key (style_key),
    INDEX idx_sort_order (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='风格配置表';

-- ============================================
-- 提示模板配置表
-- ============================================
CREATE TABLE IF NOT EXISTS prompt_configs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    prompt_key VARCHAR(50) NOT NULL UNIQUE COMMENT '提示模板标识',
    prompt_content TEXT NOT NULL COMMENT '提示模板内容',
    description VARCHAR(255) COMMENT '提示模板描述',
    is_active TINYINT DEFAULT 1 COMMENT '是否启用：0-禁用，1-启用',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_prompt_key (prompt_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='提示模板配置表';

-- ============================================
-- 楼盘表
-- ============================================
CREATE TABLE IF NOT EXISTS buildings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL COMMENT '楼盘名称',
    address VARCHAR(255) COMMENT '楼盘地址',
    developer VARCHAR(100) COMMENT '开发商',
    description TEXT COMMENT '楼盘描述',
    cover_image VARCHAR(255) COMMENT '封面图片',
    status TINYINT DEFAULT 1 COMMENT '状态：0-禁用，1-启用',
    created_by INT COMMENT '创建人ID',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_name (name),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='楼盘表';

-- ============================================
-- 楼栋表
-- ============================================
CREATE TABLE IF NOT EXISTS building_blocks (
    id INT PRIMARY KEY AUTO_INCREMENT,
    building_id INT NOT NULL COMMENT '楼盘ID',
    block_number VARCHAR(50) NOT NULL COMMENT '楼栋号（如1号楼、A栋）',
    total_floors INT COMMENT '总层数',
    total_units INT COMMENT '总户数',
    description TEXT COMMENT '楼栋描述',
    status TINYINT DEFAULT 1 COMMENT '状态：0-禁用，1-启用',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE CASCADE,
    INDEX idx_building_id (building_id),
    INDEX idx_block_number (block_number),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='楼栋表';

-- ============================================
-- 房屋表
-- ============================================
CREATE TABLE IF NOT EXISTS houses (
    id INT PRIMARY KEY AUTO_INCREMENT,
    building_id INT NOT NULL COMMENT '楼盘ID',
    block_id INT NOT NULL COMMENT '楼栋ID',
    unit_number VARCHAR(50) NOT NULL COMMENT '单元号',
    floor_number INT COMMENT '楼层',
    room_number VARCHAR(50) COMMENT '房号',
    area DECIMAL(10,2) COMMENT '面积（平方米）',
    room_count INT COMMENT '房间数',
    layout VARCHAR(50) COMMENT '户型（如：3室2厅1卫）',
    status ENUM('available', 'sold', 'reserved') DEFAULT 'available' COMMENT '状态：available-可售，sold-已售，reserved-预留',
    description TEXT COMMENT '房屋描述',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE CASCADE,
    FOREIGN KEY (block_id) REFERENCES building_blocks(id) ON DELETE CASCADE,
    INDEX idx_building_id (building_id),
    INDEX idx_block_id (block_id),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='房屋表';

-- ============================================
-- 平面图表
-- ============================================
CREATE TABLE IF NOT EXISTS floor_plans (
    id INT PRIMARY KEY AUTO_INCREMENT,
    house_id INT NOT NULL COMMENT '房屋ID',
    name VARCHAR(100) COMMENT '平面图名称',
    image_url VARCHAR(255) NOT NULL COMMENT '平面图图片URL',
    thumbnail_url VARCHAR(255) COMMENT '缩略图URL',
    file_size INT COMMENT '文件大小（字节）',
    file_type VARCHAR(50) COMMENT '文件类型',
    parse_status ENUM('pending', 'processing', 'completed', 'failed') DEFAULT 'pending' COMMENT '解析状态',
    parse_result JSON COMMENT '解析结果（JSON格式）',
    panorama_url VARCHAR(255) COMMENT '全景图URL',
    status TINYINT DEFAULT 1 COMMENT '状态：0-禁用，1-启用',
    created_by INT COMMENT '创建人ID',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (house_id) REFERENCES houses(id) ON DELETE CASCADE,
    INDEX idx_house_id (house_id),
    INDEX idx_parse_status (parse_status),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='平面图表';

-- ============================================
-- 平面图交付快照表
-- ============================================
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='平面图交付快照表';

-- ============================================
-- 操作日志表
-- ============================================
CREATE TABLE IF NOT EXISTS operation_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT COMMENT '用户ID',
    action VARCHAR(100) NOT NULL COMMENT '操作类型',
    target_type VARCHAR(50) COMMENT '操作对象类型',
    target_id INT COMMENT '操作对象ID',
    details JSON COMMENT '操作详情',
    ip_address VARCHAR(50) COMMENT 'IP地址',
    user_agent TEXT COMMENT '用户代理',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id),
    INDEX idx_action (action),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='操作日志表';

-- ============================================
-- 插入默认数据
-- ============================================

-- 插入默认管理员用户（密码：admin123）
INSERT INTO users (username, password, email, role, status) VALUES
('admin', '$2a$10$N9qo8uLOickgx2ZMRZoMy.MqrqQzBZN0UfGNEKjN3G8Z3zLQ6Z8Z2', 'admin@example.com', 'admin', 1);

-- 插入默认AI服务配置
INSERT INTO ai_service_configs (parse_service, openai_endpoint, openai_model, openai_timeout, local_service_endpoint, local_service_timeout) VALUES
('local', 'https://api.openai.com/v1/chat/completions', 'gpt-4-turbo', 30000, 'http://localhost:8000', 60000);

-- 插入默认风格配置
INSERT INTO style_configs (style_key, name, description, sort_order) VALUES
('modern', '现代风格', '简约、时尚的现代设计风格', 1),
('classic', '经典风格', '传统、典雅的经典设计风格', 2),
('minimalist', '极简风格', '简洁、纯净的极简设计风格', 3);

-- 插入默认提示模板配置
INSERT INTO prompt_configs (prompt_key, prompt_content, description) VALUES
('floorPlanParser', '你是一个专业的建筑设计师和室内设计师，擅长分析平面图并将其转换为详细的空间数据。
请分析提供的平面图，识别房间、墙体、门窗等元素，并输出结构化的JSON数据。
输出格式必须严格按照以下结构：
{
  "rooms": [
    {
      "name": "房间名称",
      "type": "房间类型（如living、bedroom、kitchen、bathroom等）",
      "area": 面积（平方米）,
      "width": 宽度（米）,
      "length": 长度（米）,
      "position": {"x": x坐标, "y": y坐标}
    }
  ],
  "walls": [
    {
      "start": {"x": x1, "y": y1},
      "end": {"x": x2, "y": y2},
      "thickness": 墙体厚度（米）
    }
  ],
  "doors": [
    {
      "position": {"x": x, "y": y},
      "width": 宽度（米）,
      "type": "门类型（如main、room、bathroom等）"
    }
  ],
  "windows": [
    {
      "position": {"x": x, "y": y},
      "width": 宽度（米）
    }
  ]
}', '平面图解析提示模板'),

('sceneConfigGenerator', '你是一个专业的3D室内设计师，擅长根据平面图和指定风格生成详细的3D场景配置。
请根据提供的平面图解析数据和风格要求，生成3D场景的详细配置，包括：
1. 材质选择
2. 家具布局
3. 灯光设置
4. 色彩方案

输出格式必须严格按照以下结构：
{
  "materials": {
    "floor": {"color": "颜色值", "texture": "纹理类型", "roughness": 粗糙度值},
    "wall": {"color": "颜色值", "texture": "纹理类型", "roughness": 粗糙度值},
    "ceiling": {"color": "颜色值", "texture": "纹理类型", "roughness": 粗糙度值}
  },
  "furniture": [
    {
      "type": "家具类型",
      "position": {"x": x, "y": y, "z": z},
      "rotation": {"x": x, "y": y, "z": z},
      "scale": {"x": x, "y": y, "z": z},
      "material": "材质类型"
    }
  ],
  "lighting": {
    "ambient": {"intensity": 强度值, "color": "颜色值"},
    "directional": {"intensity": 强度值, "color": "颜色值", "position": {"x": x, "y": y, "z": z}},
    "point": [
      {"intensity": 强度值, "color": "颜色值", "position": {"x": x, "y": y, "z": z}}
    ]
  },
  "colors": {
    "primary": "主色调",
    "secondary": "辅助色",
    "accent": "强调色"
  }
}', '3D场景配置提示模板'),

('panoramaConfigGenerator', '你是一个专业的全景图设计师，擅长根据3D场景数据生成全景图配置。
请根据提供的3D场景数据，生成全景图的详细配置，包括：
1. 相机位置和角度
2. 热点标记（如房间切换点）
3. 场景描述

输出格式必须严格按照以下结构：
{
  "cameraPositions": [
    {
      "id": "位置ID",
      "name": "位置名称",
      "position": {"x": x, "y": y, "z": z},
      "lookAt": {"x": x, "y": y, "z": z}
    }
  ],
  "hotspots": [
    {
      "id": "热点ID",
      "type": "热点类型",
      "position": {"pitch": 俯仰角, "yaw": 偏航角},
      "text": "热点文本",
      "target": "目标位置ID"
    }
  ],
  "description": "场景描述"
}', '全景图配置提示模板');

-- 插入系统配置
INSERT INTO system_configs (config_key, config_value, description) VALUES
('system_name', '"平面图管理系统"', '系统名称'),
('system_description', '"专业的平面图管理和3D全景生成系统"', '系统描述'),
('storage_type', '"local"', '存储类型：local-本地，oss-阿里云OSS，cos-腾讯云COS，s3-AWS S3'),
('max_file_size', '52428800', '最大文件大小（字节），默认50MB'),
('allowed_file_types', '["image/jpeg", "image/png", "application/pdf"]', '允许的文件类型');

-- ============================================
-- 完成
-- ============================================
SELECT '数据库初始化完成！' AS message;
