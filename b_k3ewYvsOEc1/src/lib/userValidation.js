export function userPasswordValidationMessage(password) {
  const value = String(password || '')
  if (value.trim().length < 8 || !/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
    return '密码至少需要 8 位，并同时包含字母和数字'
  }
  return ''
}
