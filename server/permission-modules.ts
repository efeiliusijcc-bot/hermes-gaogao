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
      'crawler:delete',
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
    permissions: ['draft_assistant:create', 'draft_assistant:read', 'draft_assistant:update', 'report:create', 'report:read'],
    corePermissions: ['draft_assistant:read', 'draft_assistant:create'],
  },
  {
    key: 'daily',
    label: '每日动态感知',
    description: '允许生成和查看每日动态简报。',
    permissions: ['daily_awareness:create', 'daily_awareness:read', 'daily_awareness:import', 'draft_assistant:create', 'draft_assistant:read'],
    corePermissions: ['daily_awareness:read', 'daily_awareness:create'],
  },
];

export const SYSTEM_ADMIN_PERMISSIONS = [
  'user:manage',
  'role:manage',
  'research_key:read',
  'research_key:update',
  'vector_source:read',
  'vector_source:update',
  'report:delete',
];

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
    'crawler:delete',
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
