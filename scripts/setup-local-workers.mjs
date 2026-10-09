import fs from 'fs'
import path from 'path'

const rootDir = process.cwd()

const files = [
  {
    source: path.join(rootDir, 'desktop-worker', '.env.example'),
    target: path.join(rootDir, 'desktop-worker', '.env'),
    label: 'desktop-worker/.env'
  },
  {
    source: path.join(rootDir, 'codex-worker', '.env.example'),
    target: path.join(rootDir, 'codex-worker', '.env'),
    label: 'codex-worker/.env'
  }
]

function copyIfMissing({ source, target, label }) {
  if (!fs.existsSync(source)) {
    console.error(`缺少模板文件: ${label}`)
    return false
  }

  if (fs.existsSync(target)) {
    console.log(`已存在，跳过: ${label}`)
    return true
  }

  fs.copyFileSync(source, target)
  console.log(`已创建: ${label}`)
  return true
}

const success = files.every(copyIfMissing)

if (!success) {
  process.exit(1)
}

console.log('')
console.log('下一步建议:')
console.log('1. 编辑 desktop-worker/.env，确认后台地址、账号密码、设备名称')
console.log('2. 如需真实 Codex 处理，编辑 codex-worker/.env')
console.log('3. 运行 npm run worker:start 启动桌面端任务执行器')
