# 开发计划：role-variant-permission-test

## 背景

之前线上浏览器主要使用 admin 账号验证了模块入口和编报创建。现在需要补充不同角色的验证，确认 admin、operator、viewer 以及无模块/受限角色的权限表现不同。

## 本次目标

验证不同角色在账号权限体系中的模块可见性、写权限、数据隔离和接口拦截是否符合预期。

## 本次不做

* 不修改业务主流程。
* 不修改数据库结构。
* 不修改 RBAC 映射规则，除非测试发现明确缺陷。
* 不删除线上真实业务数据。
* 不默认创建线上临时用户，除非确认现有账号不足以测试。

## 涉及范围

* 测试文件：`tests/module-permissions.test.ts`、`tests/account-permissions.test.ts`、`tests/owner-isolation.test.ts`、`tests/role-management.test.ts`
* 前端权限测试：`tests/frontend-permission-modules.test.ts`
* 浏览器线上验证：`https://hermes-gaogao.vercel.app/`
* 测试记录：`docs/dev-records/logs/2026-07-09-role-variant-permission-test.md`

## 开发步骤

1. 先运行现有账号权限测试，确认 admin / operator / viewer / 自定义模块角色的权限映射。
2. 检查测试是否覆盖 viewer 不能创建编报、operator 可创建但不能删除、admin 可管理全部。
3. 检查模块权限测试是否覆盖单模块和多模块角色。
4. 检查 owner 隔离测试是否覆盖普通用户只能访问自己的数据，admin 可访问全部。
5. 使用 Chrome 查看线上是否存在可直接切换的非 admin 测试账号入口。
6. 如果缺少非 admin 线上账号，只记录当前阻塞点，并说明需要账号或允许创建临时测试用户。

## 验证方式

* `npx tsx tests/module-permissions.test.ts`
* `npx tsx tests/account-permissions.test.ts`
* `npx tsx tests/owner-isolation.test.ts`
* `npx tsx tests/role-management.test.ts`
* `npx tsx tests/frontend-permission-modules.test.ts`
* Chrome 线上页面手动验证可用账号的模块入口和受限行为。
