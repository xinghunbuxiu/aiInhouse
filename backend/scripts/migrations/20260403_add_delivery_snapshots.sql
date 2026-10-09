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
