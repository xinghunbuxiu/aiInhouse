#!/bin/bash

# ==================================================================================
# AIInHouse 服务管理脚本
#
# 功能:
#   - 默认使用生产 (prod) 环境 (也可通过 --env=dev 指定)
#   - 编译所有项目 (后端, 前端)
#   - 启动/停止/重启/检查所有服务 (后端, 前端)
#   - 一键部署 (编译 + 重启)
#
# 用法:
#   ./install.sh [start|stop|restart|status|build|deploy] [--env=prod|dev]
#
# ==================================================================================

# --- 配置区 ---
APP_NAME="AIInHouse"
BACKEND_PORT=3002
FRONTEND_PORT=5173
AGENT_PORT=3003

# --- 颜色定义 ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# --- 路径和环境配置 ---
BASE_DIR=$(cd "$(dirname "$0")" && pwd)
COMMAND=$1
# 环境默认为 'prod'，如果第二个参数是 'dev'，则覆盖为 'dev'
ENV="prod"
if [ "$2" == "dev" ]; then
    ENV="dev"
fi

# 如果没有指定命令，则显示帮助
if [ -z "$COMMAND" ]; then
    echo "用法: $0 {start|stop|restart|status|build|deploy} [dev]"
    echo ""
    echo "命令说明:"
    echo "  start   - 编译并启动所有服务"
    echo "  stop    - 停止所有服务"
    echo "  restart - 重新编译并重启所有服务"
    echo "  status  - 检查所有服务的运行状态"
    echo "  build   - 仅编译所有项目，不启动服务"
    echo "  deploy  - [推荐] 同步最新代码 -> 编译 -> 重启服务"
    echo ""
    echo "环境参数 (可选):"
    echo "  dev     - 使用开发环境配置 (例如: ./install.sh start dev)"
    echo "          (不带此参数则默认为 prod 正式环境)"
    exit 1
fi

BACKEND_DIR="$BASE_DIR/backend"
FRONTEND_DIR="$BASE_DIR"
LOG_DIR="$BASE_DIR/logs"

# 确保日志目录存在
mkdir -p "$LOG_DIR"

# ==================================================================================
# 辅助函数
# ==================================================================================

# 和远程仓库强制同步代码
function sync_code() {
    echo -e "${BLUE}=== [1/4] 正在从 Gitee 强制同步最新代码 ===${NC}"
    # 设置远程仓库地址
    GIT_REMOTE_URL="https://oauth2:938c2897ff86af09a48e83aa1a6c9c7f@gitee.com/xinghunbuxiu/aiinhouse.git"
    
    # 确保 git 安全目录设置
    git config --global --add safe.directory "$BASE_DIR"

    # 强制同步远程 'main' 分支
    git fetch --all
    git reset --hard origin/main
    git clean -fd

    echo -e "${GREEN}=== 代码同步完成 ===${NC}"
}

# 初始化数据库
function init_database() {
    echo -e "${BLUE}=== [1/3] 正在初始化数据库 ===${NC}"
    
    # 检查 MySQL 是否运行
    if [ -z "$(lsof -t -i:3306 2>/dev/null)" ]; then
        echo -n -e "  -> 尝试启动 MySQL... "
        if command -v systemctl &> /dev/null; then
            sudo systemctl start mysql > /dev/null 2>&1
        elif command -v service &> /dev/null; then
            sudo service mysql start > /dev/null 2>&1
        else
            # 最后的备选方案
            nohup mysqld > /dev/null 2>&1 &
        fi
        sleep 2
        if [ -n "$(lsof -t -i:3306 2>/dev/null)" ]; then
            echo -e "${GREEN}已启动${NC}"
        else
            echo -e "${RED}启动失败, 请手动检查 MySQL 服务状态。${NC}"
            return 1
        fi
    fi
    
    # 优先使用后端初始化脚本
    echo -e "  -> 执行后端数据库初始化脚本..."
    cd "$BACKEND_DIR"
    npm run init-db
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}数据库初始化成功${NC}"
        return 0
    else
        echo -e "${RED}数据库初始化失败${NC}"
        return 1
    fi
}

# ==================================================================================
# 核心功能函数
# ==================================================================================

# 检查端口并停止进程
function stop_process_by_port() {
    local port=$1
    local service_name=$2
    local pid=$(lsof -t -i:$port 2>/dev/null)
    if [ -n "$pid" ]; then
        echo -n -e "  -> 正在停止 $service_name (PID: $pid)... "
        kill -9 $pid
        echo -e "${GREEN}已停止${NC}"
    else
        echo -e "  -> $service_name 未在运行"
    fi
}

# 编译项目
function build_services() {
    echo -e "${BLUE}=== [2/4] 开始编译项目 (环境: $ENV) ===${NC}"
    
    echo -e "${YELLOW}[后端] 正在安装依赖...${NC}"
    cd "$BACKEND_DIR"
    npm install --registry=https://registry.npmmirror.com
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}后端依赖安装失败！${NC}"
        exit 1
    fi
    
    echo -e "${YELLOW}[前端] 正在安装依赖...${NC}"
    cd "$FRONTEND_DIR"
    npm install --registry=https://registry.npmmirror.com
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}前端依赖安装失败！${NC}"
        exit 1
    fi
    
    if [ "$ENV" == "prod" ]; then
        echo -e "${YELLOW}[前端] 正在构建生产版本...${NC}"
        npm run build
        
        if [ $? -ne 0 ]; then
            echo -e "${RED}前端构建失败！${NC}"
            exit 1
        fi
    fi
    
    echo -e "${GREEN}=== 所有项目编译成功 ===${NC}"
}

# 启动服务
function start_services() {
    echo -e "${BLUE}=== [3/4] 正在启动服务 (环境: $ENV) ===${NC}"

    # 启动后端
    if [ -z "$(lsof -t -i:$BACKEND_PORT 2>/dev/null)" ]; then
        echo -n -e "  -> 启动后端服务... "
        cd "$BACKEND_DIR"
        if [ "$ENV" == "prod" ]; then
            nohup npm start > "$LOG_DIR/backend.log" 2>&1 &
        else
            nohup npm run dev > "$LOG_DIR/backend.log" 2>&1 &
        fi
        sleep 2
        echo -e "${GREEN}已启动${NC}"
    else
        echo -e "  -> 后端服务已在运行"
    fi

    # 启动前端
    if [ -z "$(lsof -t -i:$FRONTEND_PORT 2>/dev/null)" ]; then
        echo -n -e "  -> 启动前端服务... "
        cd "$FRONTEND_DIR"
        if [ "$ENV" == "prod" ]; then
            nohup npx vite preview --port $FRONTEND_PORT --host > "$LOG_DIR/frontend.log" 2>&1 &
        else
            nohup npm run dev -- --port $FRONTEND_PORT --host > "$LOG_DIR/frontend.log" 2>&1 &
        fi
        sleep 2
        echo -e "${GREEN}已启动${NC}"
    else
        echo -e "  -> 前端服务已在运行"
    fi

    # 启动代理服务
    if [ -z "$(lsof -t -i:$AGENT_PORT 2>/dev/null)" ]; then
        echo -n -e "  -> 启动数据爬取代理服务... "
        cd "$BASE_DIR"
        nohup node scripts/agent.js > "$LOG_DIR/agent.log" 2>&1 &
        sleep 2
        echo -e "${GREEN}已启动${NC}"
    else
        echo -e "  -> 代理服务已在运行"
    fi
    
    echo -e "${BLUE}=== 服务启动指令已全部发送 ===${NC}"
}

# 停止服务
function stop_services() {
    echo -e "${BLUE}=== 正在停止服务 ===${NC}"
    stop_process_by_port $BACKEND_PORT "后端服务"
    stop_process_by_port $FRONTEND_PORT "前端服务"
    stop_process_by_port $AGENT_PORT "代理服务"
    
    echo -e "${GREEN}=== 所有服务已停止 ===${NC}"
}

# 状态检查
function check_status() {
    echo -e "${BLUE}--- 服务状态 (环境: $ENV) ---${NC}"
    status_fmt() {
        local name=$1
        local port=$2
        local pid=$(lsof -t -i:$port 2>/dev/null)
        if [ -n "$pid" ]; then
            echo -e "$name: ${GREEN}● 运行中${NC} (PID: $pid)"
        else
            echo -e "$name: ${RED}○ 已停止${NC}"
        fi
    }
    status_fmt "后端服务  " $BACKEND_PORT
    status_fmt "前端服务  " $FRONTEND_PORT
    status_fmt "代理服务  " $AGENT_PORT
    
    # 检查 MySQL 状态
    if [ -n "$(lsof -t -i:3306 2>/dev/null)" ]; then
        echo -e "MySQL: ${GREEN}● 运行中${NC}"
    else
        echo -e "MySQL: ${RED}○ 已停止${NC}"
    fi
}

# 执行命令
case "$COMMAND" in
    start)   sync_code;build_services; start_services ;;
    stop)    stop_services ;;
    status)  check_status ;;
    restart) sync_code;stop_services; sleep 2; build_services; start_services ;;
    build)   sync_code;build_services ;;
    deploy)  sync_code; init_database; build_services; stop_services; sleep 2; start_services ;;
esac

exit 0
