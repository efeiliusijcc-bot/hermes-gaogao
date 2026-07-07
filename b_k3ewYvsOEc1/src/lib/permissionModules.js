export const BUSINESS_MODULES = ['report', 'qa', 'draft', 'daily']

export const SYSTEM_ROLE_MODULES = {
  admin: ['report', 'qa', 'draft', 'daily'],
  operator: ['report', 'qa', 'draft', 'daily'],
  viewer: ['qa', 'daily'],
}

const MODULE_KEYS = new Set(BUSINESS_MODULES)

const MODULE_PERMISSION_HINTS = {
  report: [
    'report:create',
    'report:read',
    'report:update',
    'crawler:create',
    'crawler:read',
    'crawler:execute',
    'template:create',
    'template:read',
    'template:update',
    'template:delete',
    'preference:read',
    'preference:update',
  ],
  qa: ['chat:execute', 'chat:read'],
  draft: ['draft_assistant:create', 'draft_assistant:read', 'draft_assistant:update'],
  daily: ['daily_awareness:create', 'daily_awareness:read', 'daily_awareness:import'],
}

function uniqueStrings(values) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  ))
}

export function normalizeModules(value) {
  return uniqueStrings(value).filter((module) => MODULE_KEYS.has(module))
}

export function modulesFromPermissions(permissions) {
  const permissionSet = new Set(uniqueStrings(permissions))
  return BUSINESS_MODULES.filter((module) => {
    return MODULE_PERMISSION_HINTS[module].some((permission) => permissionSet.has(permission))
  })
}

export function deriveUserModules(user) {
  if (user && Object.prototype.hasOwnProperty.call(user, 'modules')) {
    return normalizeModules(user.modules)
  }

  const explicitModules = normalizeModules(user?.modules)
  if (explicitModules.length) return explicitModules

  const permissionModules = modulesFromPermissions(user?.permissions)
  if (permissionModules.length) return permissionModules

  const roleNames = uniqueStrings([
    user?.role,
    ...(Array.isArray(user?.roles) ? user.roles : []),
  ])
  for (const roleName of roleNames) {
    const modules = SYSTEM_ROLE_MODULES[roleName]
    if (modules?.length) return modules.slice()
  }

  return []
}

export function deriveRoleModules(role) {
  if (role && Object.prototype.hasOwnProperty.call(role, 'modules')) {
    return normalizeModules(role.modules)
  }

  const explicitModules = normalizeModules(role?.modules)
  if (explicitModules.length) return explicitModules

  const permissionModules = modulesFromPermissions(role?.permissions)
  if (permissionModules.length) return permissionModules

  const modules = SYSTEM_ROLE_MODULES[String(role?.name || '').trim()]
  return modules?.length ? modules.slice() : []
}
