export function userPasswordValidationState(password) {
  const value = String(password || '')
  if (!value) {
    return {
      valid: false,
      touched: false,
      message: '密码至少 8 位，并同时包含字母和数字',
    }
  }

  const missing = []
  if (value.trim().length < 8) missing.push('至少 8 位')
  if (!/[A-Za-z]/.test(value)) missing.push('包含字母')
  if (!/[0-9]/.test(value)) missing.push('包含数字')

  if (missing.length) {
    return {
      valid: false,
      touched: true,
      message: `密码还需${missing.join('、')}`,
    }
  }

  return {
    valid: true,
    touched: true,
    message: '密码要求已满足',
  }
}

export function userPasswordValidationMessage(password) {
  if (!userPasswordValidationState(password).valid) {
    return '密码至少需要 8 位，并同时包含字母和数字'
  }
  return ''
}
