export type PermissionModule = 'report' | 'qa' | 'draft' | 'daily';

export interface PermissionModuleDefinition {
  key: PermissionModule;
  label: string;
  description: string;
  permissions: string[];
  corePermissions: string[];
}

export const PERMISSION_MODULES: PermissionModuleDefinition[] = [
  {
    key: 'report',
    label: '编报',
    description: '允许创建、查看和管理自己的编报任务。',
    permissions: [
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
    corePermissions: ['report:read', 'report:create'],
  },
  {
    key: 'qa',
    label: '问答',
    description: '允许使用知识库问答和查看自己的问答历史。',
    permissions: ['chat:execute', 'chat:read'],
    corePermissions: ['chat:execute'],
  },
  {
    key: 'draft',
    label: '拟稿',
    description: '允许使用拟稿助手进行事件分析和提纲生成。',
    permissions: ['draft_assistant:create', 'draft_assistant:read', 'draft_assistant:update'],
    corePermissions: ['draft_assistant:read', 'draft_assistant:create'],
  },
  {
    key: 'daily',
    label: '每日动态感知',
    description: '允许生成和查看每日动态简报。',
    permissions: ['daily_awareness:create', 'daily_awareness:read', 'daily_awareness:import'],
    corePermissions: ['daily_awareness:read', 'daily_awareness:create'],
  },
];

export const BUSINESS_MODULE_PERMISSIONS = uniqueStrings(PERMISSION_MODULES.flatMap((module) => module.permissions));

export const SYSTEM_ADMIN_PERMISSIONS = [
  'user:manage',
  'role:manage',
  'research_key:read',
  'research_key:update',
  'vector_source:read',
  'vector_source:update',
  'report:delete',
  'crawler:delete',
];

export const SYSTEM_ROLE_PERMISSIONS: Record<'admin' | 'operator' | 'viewer', string[]> = {
  admin: [
    'report:create',
    'report:read',
    'report:update',
    'report:delete',
    'chat:execute',
    'chat:read',
    'research_key:read',
    'research_key:update',
    'vector_source:read',
    'vector_source:update',
    'user:manage',
    'role:manage',
    'draft_assistant:create',
    'draft_assistant:read',
    'draft_assistant:update',
    'daily_awareness:create',
    'daily_awareness:read',
    'daily_awareness:import',
    'preference:read',
    'preference:update',
    'template:create',
    'template:read',
    'template:update',
    'template:delete',
    'crawler:create',
    'crawler:execute',
    'crawler:read',
    'crawler:delete',
  ],
  operator: [
    'report:create',
    'report:read',
    'report:update',
    'chat:execute',
    'chat:read',
    'draft_assistant:create',
    'draft_assistant:read',
    'draft_assistant:update',
    'daily_awareness:create',
    'daily_awareness:read',
    'daily_awareness:import',
    'preference:read',
    'preference:update',
    'template:create',
    'template:read',
    'template:update',
    'template:delete',
    'crawler:create',
    'crawler:execute',
    'crawler:read',
  ],
  viewer: [
    'chat:execute',
    'chat:read',
    'daily_awareness:read',
  ],
};

const MODULE_KEYS = new Set(PERMISSION_MODULES.map((module) => module.key));

export function normalizeModules(value: unknown): PermissionModule[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .map((item) => String(item || '').trim())
      .filter((item): item is PermissionModule => MODULE_KEYS.has(item as PermissionModule)),
  ));
}

export function permissionsFromModules(modules: unknown): string[] {
  const selected = new Set(normalizeModules(modules));
  const permissions: string[] = [];
  for (const module of PERMISSION_MODULES) {
    if (!selected.has(module.key)) continue;
    permissions.push(...module.permissions);
  }
  return uniqueStrings(permissions);
}

export function modulesFromPermissions(permissions: unknown): PermissionModule[] {
  const permissionSet = new Set(Array.isArray(permissions) ? permissions.map((item) => String(item || '').trim()).filter(Boolean) : []);
  const modules: PermissionModule[] = [];

  const hasAny = (values: string[]) => values.some((permission) => permissionSet.has(permission));
  const hasDaily = hasAny(['daily_awareness:create', 'daily_awareness:read', 'daily_awareness:import']);
  const hasDraft = permissionSet.has('draft_assistant:update') || (hasAny(['draft_assistant:create', 'draft_assistant:read']) && !hasDaily);
  const hasReportSpecific = hasAny([
    'report:update',
    'crawler:create',
    'crawler:execute',
    'crawler:read',
    'template:create',
    'template:read',
    'template:update',
    'template:delete',
    'preference:read',
    'preference:update',
  ]);
  const hasReportReadOnly = hasAny(['report:create', 'report:read']) && !hasDraft;

  if (hasReportSpecific || hasReportReadOnly) modules.push('report');
  if (hasAny(['chat:execute', 'chat:read'])) modules.push('qa');
  if (hasDraft) modules.push('draft');
  if (hasDaily) modules.push('daily');

  return modules;
}

export function uniqueStrings(values: unknown[]): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}
