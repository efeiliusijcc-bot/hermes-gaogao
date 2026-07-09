# 开发计划：deploy-report-plan-permission-fix

## 背景

`user1` 绑定 `test1` 后仍无法编报，根因已定位并在本地修复：旧 `RolesGuard` 抢先拦截了已接入 `@RequirePermissions()` 的接口。现在需要提交代码并部署到线上，使修复在 Vercel 页面生效。

## 本次目标

提交并部署本地修复，让拥有 `report:create` 权限的多角色用户可以正常生成编报规划和创建编报任务。

## 本次不做

* 不修改数据库结构。
* 不调整用户密码。
* 不重置线上账号。
* 不继续改前端页面。
* 不删除线上测试任务。

## 涉及范围

* Git 提交：权限修复、回归测试、开发记录。
* 部署脚本：项目现有部署脚本。
* 验证命令：权限测试和后端构建。

## 开发步骤

1. 检查当前 Git 改动，确认提交范围。
2. 运行关键测试和后端构建。
3. 暂存本次权限修复相关文件和开发记录。
4. 创建 Git 提交。
5. 推送到 GitHub。
6. 执行部署脚本。
7. 记录提交、部署和验证结果。

## 验证方式

* `npx tsx tests/account-permissions.test.ts`
* `npx tsx tests/module-permissions.test.ts`
* `npx tsx tests/role-management.test.ts`
* `npx pnpm@9.15.9 build`
* 部署脚本输出。
