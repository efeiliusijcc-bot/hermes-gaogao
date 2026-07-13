# 开发记录：允许用户不绑定角色

## 完成内容

用户现在可以在创建时不绑定任何角色，也可以在编辑时清空全部角色。用户列表对明确的空角色数组显示“暂无角色”，不再回退显示观察员。无角色用户不会获得功能模块或权限。

## 实际改动文件

* `server/users.service.ts`：区分“未传 roles”与“明确传 roles: []”，允许清空 `user_roles`。
* `b_k3ewYvsOEc1/src/components/UserManagement.vue`：创建和编辑时不再自动补观察员；空角色用户显示“暂无角色”。
* `b_k3ewYvsOEc1/src/lib/permissionModules.js`：明确空 roles 时不使用旧 role 字段回退展示。
* `tests/role-management.test.ts`：覆盖创建无角色用户、编辑清空角色、模块和权限为空。
* `tests/frontend-permission-modules.test.ts`：覆盖明确空角色与旧响应缺少 roles 字段两种展示。
* `docs/dev-records/plans/2026-07-13-users-without-roles.md`：记录开发范围与验证方案。

## 关键行为决策

* `roles: []` 表示管理员明确要求用户无角色，后端必须清空绑定。
* 请求完全不包含 `roles` 时，仍允许旧客户端通过 `role` 字段工作。
* `users.role` 继续保留且可以保持 `viewer`，仅用于旧字段兼容；实际权限以 `user_roles` 为准。
* admin 最后一个管理员保护保持不变，不能借空角色绕过。

## 验证结果

* TDD 失败验证：修改前后端会把空数组重新绑定为 viewer，前端会显示观察员，测试均准确失败。
* `npx tsx tests/frontend-permission-modules.test.ts`：通过。
* `npx tsx tests/role-management.test.ts`：通过。
* `npx tsx tests/module-permissions.test.ts`：通过。
* `npx tsx tests/account-permissions.test.ts`：通过。
* `npx pnpm@9.15.9 build`：通过。
* `npx pnpm@9.15.9 --dir b_k3ewYvsOEc1 build`：通过；仅有已有的 Browserslist 数据更新提示。

## 额外操作

* 本次未修改数据库结构、环境变量和依赖。
* 后端代码变更部署后需要重启后端服务。
* 前端代码推送后需要等待 Vercel 自动部署。

## 已知风险

* 旧数据如果没有 `user_roles` 绑定但旧响应又不包含 `roles` 字段，前端仍按 `users.role` 兼容显示；正常 RBAC 接口会返回明确的空数组。
* 无角色用户仍可登录，但没有业务模块和业务权限，这是本次预期行为。

## 后续排查入口

如果无角色用户仍显示观察员或获得模块，优先检查：

1. 用户接口响应是否明确包含 `roles: []`。
2. 更新请求是否传入 `roles: []`，而不是省略 roles。
3. `user_roles` 中是否仍有该用户的绑定记录。
4. 前端是否仍用 `user.role` 覆盖明确的空 roles。
5. 登录 JWT 中的 roles、modules、permissions 是否均为空。
