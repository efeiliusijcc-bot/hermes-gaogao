# 开发计划：account-permission-tests

## 背景

需要为账号权限系统补充自动化测试，重点验证角色模块权限是否真正生效、普通用户是否只能访问自己的数据、admin 是否可以访问全部数据，以及前端模块入口是否按用户 modules 正确显示。

## 本次目标

补充或完善权限相关测试用例，让后续开发者可以通过测试快速确认 RBAC 模块权限和 owner/admin 数据隔离没有回归。

## 本次不做

* 不重构账号权限主流程。
* 不修改数据库结构。
* 不调整登录接口格式。
* 不修改业务生成链路。
* 不改前端 UI 样式。

## 涉及范围

* 后端权限测试：`tests/account-permissions.test.ts`、`tests/module-permissions.test.ts`、可能新增或扩展 owner 隔离测试。
* 前端模块测试：`tests/frontend-permission-modules.test.ts`。
* 相关服务：report jobs、chat sessions、draft events、daily briefs、crawler tasks、user preferences/templates/snippets。
* 文档记录：`docs/dev-records/logs/2026-07-08-account-permission-tests.md`。

## 开发步骤

1. 读取用户附件中的完整测试要求。
2. 检查当前已有权限测试覆盖范围，避免重复但补齐缺口。
3. 按要求新增或扩展测试用例。
4. 运行权限相关测试和必要构建。
5. 将完成内容、验证结果和后续排查入口写入开发记录。

## 验证方式

* `npx tsx tests/account-permissions.test.ts`
* `npx tsx tests/module-permissions.test.ts`
* `npx tsx tests/owner-isolation.test.ts`
* `npx tsx tests/frontend-permission-modules.test.ts`
* 如改动影响编译，运行 `npx pnpm@9.15.9 build`
