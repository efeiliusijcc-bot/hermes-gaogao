# 开发计划：report-plan-role-permission-mismatch

## 背景

线上 `user1` 绑定了 `test1` 角色后，用户在编报规划确认阶段看到 `Insufficient role permissions`，无法继续编报。截图显示当前账号仍是观察员身份，但用户期望通过绑定 `test1` 获得对应模块和写入权限。

## 本次目标

排查为什么用户已经绑定业务角色/模块后仍被编报接口拒绝，并修复“旧固定 role 守卫”和“新 RBAC 权限点”之间的冲突，让拥有 `report:create` 的用户可以生成编报规划和创建编报任务。

## 本次不做

* 不重构整个 RBAC 系统。
* 不修改数据库结构。
* 不调整 report-jobs 主生成流程。
* 不改 QA、Daily Awareness、Draft Assistant 业务流程。
* 不删除或重置线上用户。

## 涉及范围

* 后端接口：`POST /api/report-plans`
* 权限逻辑：`RolesGuard`、`PermissionsGuard`、`@Roles()`、`@RequirePermissions()`
* 测试文件：`tests/account-permissions.test.ts`、必要时新增/修改模块权限测试
* 记录文件：`docs/dev-records/logs/2026-07-09-report-plan-role-permission-mismatch.md`

## 开发步骤

1. 复现 `user1` 绑定 `test1` 仍无法编报的接口错误。
2. 检查 `report-plans.controller.ts` 是否同时使用旧 `@Roles('admin','operator')` 和新 `@RequirePermissions('report:create')`。
3. 检查 `RolesGuard` 的处理方式，确认是否先按 `user.role` 拦截，导致多角色/权限点无法生效。
4. 写回归测试：viewer 基础角色但拥有 `report:create` 权限时，`POST /api/report-plans` 应成功。
5. 做最小修复，优先让声明了 `@RequirePermissions()` 的接口由权限点决定放行，旧 `@Roles()` 只作为未接入权限点接口的兼容保护。
6. 运行相关权限测试和后端构建。

## 验证方式

* `npx tsx tests/account-permissions.test.ts`
* `npx tsx tests/module-permissions.test.ts`
* `npx tsx tests/role-management.test.ts`
* `npx pnpm@9.15.9 build`
* 可选线上验证：用 `user1 / 123456` 绑定 `test1` 后重新调用 `POST /api/report-plans`。
