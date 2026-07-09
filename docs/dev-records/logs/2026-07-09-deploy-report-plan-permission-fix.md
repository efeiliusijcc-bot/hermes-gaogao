# 开发记录：deploy-report-plan-permission-fix

## 完成内容

本次已提交并部署 `report-plans` RBAC 鉴权修复。修复后，基础 `role` 为 `viewer` 但通过自定义角色拥有 `report:create` 的用户，可以正常调用 `POST /api/report-plans`，不会再被旧 `RolesGuard` 提前拦截。

## 实际改动文件

* `server/roles.guard.ts`：声明了 `@RequirePermissions()` 的接口跳过旧角色拦截，交给 `PermissionsGuard` 按权限点判断。
* `tests/account-permissions.test.ts`：新增 `viewer + test1/report:create` 访问 `POST /api/report-plans` 的回归测试。
* `tests/module-permissions.test.ts`：补充模块权限映射测试。
* `tests/owner-isolation.test.ts`：补充 owner/admin 隔离和无模块权限测试。
* `tests/role-management.test.ts`：补充系统角色保护测试。
* `docs/dev-records/plans/*.md`：补充本阶段开发计划记录。
* `docs/dev-records/logs/2026-07-09-deploy-report-plan-permission-fix.md`：记录本次提交与部署结果。

## 关键行为决策

* 不删除旧 `@Roles()`，避免影响仍未迁移到权限点的接口。
* 对已经声明 `@RequirePermissions()` 的接口，以 RBAC 权限点为准。
* 部署脚本只发布后端，因此本次只部署后端修复。

## 验证结果

本地验证：

* `npx tsx tests/account-permissions.test.ts`：通过。
* `npx tsx tests/module-permissions.test.ts`：通过。
* `npx tsx tests/role-management.test.ts`：通过。
* `npx pnpm@9.15.9 build`：通过。

Git：

* 提交：`b5bdd43 Fix RBAC permission guard for report plans`
* 推送：`main -> origin/main` 成功。

部署：

* `bash deploy.sh`：通过。
* 远端 Docker 镜像构建成功。
* 数据库初始化脚本执行完成。
* `hermes-api` 容器已替换并启动。
* 健康检查返回：`{"ok":true,"status":"ready"}`。
* 远端 `/api/auth/me` admin 校验成功。
* 远端 `/api/vector-sources/status` 校验成功。

线上回归验证：

* 登录账号：`user1 / 123456`
* 当前角色：`viewer + test1`
* 当前模块：`report / qa / draft / daily`
* `report:create`：存在。
* `POST /api/report-plans`：返回 201。
* 返回内容包含编报规划标题：`user1 RBAC 部署后编报权限验证：编报规划`。

## 额外操作

本次涉及：

* Git 提交。
* GitHub 推送。
* 后端云节点 Docker 部署。
* 远端数据库初始化脚本重复执行，脚本均为幂等写法。

本次未涉及：

* 前端构建部署。
* 数据库结构破坏性迁移。
* 用户密码重置。
* 线上用户删除。

## 已知风险

* 当前修复只影响带 `@RequirePermissions()` 的接口。未接权限点的旧接口仍由 `@Roles()` 判断。
* 前端入口显示仍主要基于 `modules`，具体写入能力以后端 `permissions` 为准。
* 部署日志中远端服务器提示有多次失败登录记录，应后续关注服务器 SSH 安全。

## 后续排查入口

如果用户再次遇到“有角色但不能写”的问题，优先检查：

1. `/api/auth/me` 返回的 `roles` 和 `permissions`。
2. 目标接口是否声明了 `@RequirePermissions()`。
3. `RolesGuard` 是否仍在没有权限点的接口上生效。
4. `role_permissions` 是否给自定义角色绑定了对应权限点。
5. 前端是否只显示模块但没有根据权限点处理写入按钮状态。
