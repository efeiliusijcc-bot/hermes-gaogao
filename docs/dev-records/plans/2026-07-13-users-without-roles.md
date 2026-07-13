# 开发计划：允许用户不绑定角色

## 背景

用户管理当前在未勾选角色时仍会把用户绑定为观察员，列表也会通过旧 `role` 字段回退显示观察员。这与“用户可以暂时不分配任何角色”的管理需求不一致。

## 本次目标

* 新建用户时允许提交空角色数组。
* 编辑用户时允许清空全部角色。
* 空角色用户返回 `roles: []`、`modules: []`、`permissions: []`。
* 用户列表显示“暂无角色”，不显示观察员。
* 保留旧客户端仅传 `role` 字段的兼容行为。

## 本次不做

* 不删除或修改 `users.role` 数据库字段。
* 不修改 RBAC 表结构和权限点。
* 不改变 admin 最后一个管理员保护逻辑。
* 不修改登录主流程和其他业务模块。

## 涉及范围

* 后端用户服务：`server/users.service.ts`
* 前端用户管理：`b_k3ewYvsOEc1/src/components/UserManagement.vue`
* 前端角色展示工具：`b_k3ewYvsOEc1/src/lib/permissionModules.js`
* 测试：`tests/role-management.test.ts`、`tests/frontend-permission-modules.test.ts`
* 开发记录：`docs/dev-records/logs/2026-07-13-users-without-roles.md`

## 开发步骤

1. 先增加失败测试，覆盖创建空角色、编辑清空角色和前端“暂无角色”显示。
2. 后端区分“没有传 roles”与“明确传 roles: []”，后者清空 `user_roles`。
3. 前端提交时不再为未选择角色自动补 `viewer`。
4. 用户列表只按 `roles` 展示角色，空数组显示“暂无角色”。
5. 验证空角色用户没有模块和权限，并回归多角色、admin 保护与旧 role 兼容。

## 验证方式

* `npx tsx tests/role-management.test.ts`
* `npx tsx tests/frontend-permission-modules.test.ts`
* `npx tsx tests/module-permissions.test.ts`
* `npx pnpm@9.15.9 build`
* `npx pnpm@9.15.9 --dir b_k3ewYvsOEc1 build`
* 页面验证：新建用户时不勾选角色，列表显示“暂无角色”；编辑已有用户并取消全部角色后，模块列显示“暂无模块”。
