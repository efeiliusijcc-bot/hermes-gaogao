import { computed, ref } from 'vue'
import {
  clearAuthSession,
  getAuthToken,
  getCurrentUser,
  getStoredAuthUser,
  login as loginRequest,
  logout as logoutStorage,
  setAuthSession,
  setUnauthorizedHandler,
} from '../lib/api.js'

const accessToken = ref(getAuthToken())
const currentUser = ref(getStoredAuthUser())
const isLoading = ref(false)
const errorMessage = ref('')
const notice = ref('')
let initialized = false

const isLoggedIn = computed(() => Boolean(accessToken.value && currentUser.value))
const isAdmin = computed(() => currentUser.value?.role === 'admin')
const isOperator = computed(() => currentUser.value?.role === 'operator')
const isViewer = computed(() => currentUser.value?.role === 'viewer')

function clearAuthState(message = '') {
  clearAuthSession()
  accessToken.value = ''
  currentUser.value = null
  if (message) notice.value = message
}

async function initializeAuth() {
  if (!initialized) {
    initialized = true
    setUnauthorizedHandler(() => {
      clearAuthState('登录状态已失效，请重新登录')
    })
  }
  accessToken.value = getAuthToken()
  currentUser.value = getStoredAuthUser()
  if (!accessToken.value) return null

  isLoading.value = true
  errorMessage.value = ''
  try {
    const user = await getCurrentUser()
    currentUser.value = user
    setAuthSession(accessToken.value, user)
    return user
  } catch (error) {
    clearAuthState('登录状态已失效，请重新登录')
    errorMessage.value = error instanceof Error ? error.message : String(error)
    return null
  } finally {
    isLoading.value = false
  }
}

async function login(username, password) {
  isLoading.value = true
  errorMessage.value = ''
  notice.value = ''
  try {
    const result = await loginRequest(username, password)
    accessToken.value = result.access_token || ''
    currentUser.value = result.user || null
    setAuthSession(accessToken.value, currentUser.value)
    notice.value = '登录成功'
    return true
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
    return false
  } finally {
    isLoading.value = false
  }
}

function logout() {
  logoutStorage()
  accessToken.value = ''
  currentUser.value = null
  errorMessage.value = ''
  notice.value = '已退出登录'
}

function setNotice(message) {
  notice.value = String(message || '')
}

export function useAuth() {
  return {
    accessToken,
    currentUser,
    isLoggedIn,
    isAdmin,
    isOperator,
    isViewer,
    isLoading,
    errorMessage,
    notice,
    initializeAuth,
    login,
    logout,
    setNotice,
  }
}
