import axios from 'axios'

function isDesktopRuntime() {
  return typeof window !== 'undefined' && (
    window.location.protocol === 'file:' ||
    Boolean(window.__TAURI_INTERNALS__)
  )
}

function normalizeApiBaseUrl(baseUrl) {
  if (!baseUrl) {
    return ''
  }

  return baseUrl.replace(/\/+$/, '')
}

function resolveApiBaseUrl() {
  const configuredBaseUrl = normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL)

  if (configuredBaseUrl) {
    return configuredBaseUrl
  }

  if (isDesktopRuntime()) {
    return 'http://127.0.0.1:3002/api'
  }

  if (typeof window !== 'undefined' && window.location.hostname) {
    const { protocol, hostname } = window.location
    return `${protocol}//${hostname}:3002/api`
  }

  return 'http://127.0.0.1:3002/api'
}

export function getLoginRoute() {
  return isDesktopRuntime() ? '/#/login' : '/login'
}

export const API_BASE_URL = resolveApiBaseUrl()
export const API_ROOT_URL = API_BASE_URL.replace(/\/api\/?$/, '')

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20000,
  headers: {
    'Content-Type': 'application/json'
  }
})

apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token')

    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }

    return config
  },
  (error) => Promise.reject(error)
)

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')

      const loginRoute = getLoginRoute()

      if (typeof window !== 'undefined' && window.location.href && !window.location.href.includes('/login')) {
        window.location.href = loginRoute
      }
    }

    return Promise.reject(error)
  }
)

export default apiClient
