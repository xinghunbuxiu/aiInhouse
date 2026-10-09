function isTauriRuntimeAvailable() {
  return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__)
}

async function invokeTauri(command, payload = {}) {
  const mod = await import('@tauri-apps/api/core')
  return mod.invoke(command, payload)
}

export function isDesktopRuntimeAvailable() {
  return isTauriRuntimeAvailable()
}

export async function getDesktopRuntimeStatus() {
  if (!isTauriRuntimeAvailable()) {
    return null
  }

  return invokeTauri('runtime_get_status')
}

export async function getDesktopRuntimeConfig() {
  if (!isTauriRuntimeAvailable()) {
    return null
  }

  return invokeTauri('runtime_get_config')
}

export async function saveDesktopRuntimeConfig(config) {
  if (!isTauriRuntimeAvailable()) {
    throw new Error('当前不是桌面版运行环境')
  }

  return invokeTauri('runtime_save_config', { config })
}

export async function startDesktopService(serviceName) {
  if (!isTauriRuntimeAvailable()) {
    throw new Error('当前不是桌面版运行环境')
  }

  return invokeTauri('runtime_start_service', { serviceName })
}

export async function stopDesktopService(serviceName) {
  if (!isTauriRuntimeAvailable()) {
    throw new Error('当前不是桌面版运行环境')
  }

  return invokeTauri('runtime_stop_service', { serviceName })
}

export async function restartDesktopService(serviceName) {
  if (!isTauriRuntimeAvailable()) {
    throw new Error('当前不是桌面版运行环境')
  }

  return invokeTauri('runtime_restart_service', { serviceName })
}
