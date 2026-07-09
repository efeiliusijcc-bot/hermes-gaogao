# 开发计划：report-job-forbidden-failure

## 背景

线上编报任务 `8eed2c44-da62-4da9-ba54-803145644397` 在执行过程中失败，页面显示 `Forbidden Exception`。日志显示任务已进入 running，并完成 PG vector 召回 27 条信源，随后在资料采集工具阶段失败。

## 本次目标

定位该任务失败的真实原因，确认是权限点缺失、owner 校验、内部接口 token、crawler 权限、还是前端/后端状态不一致导致的 `Forbidden Exception`。

## 本次不做

* 不修改数据库结构。
* 不删除失败任务。
* 不重置用户密码。
* 不擅自调整用户角色权限。
* 不直接重跑任务，除非确认根因后需要验证。

## 涉及范围

* 后端服务：`ReportsService`、`ReportsController`、`CrawlerService`、`CrawlerController`
* 权限逻辑：`PermissionsGuard`、`RolesGuard`、owner/admin 校验
* 线上容器日志：`hermes-api`
* 任务数据：`8eed2c44-da62-4da9-ba54-803145644397`
* 记录文件：`docs/dev-records/logs/2026-07-10-report-job-forbidden-failure.md`

## 开发步骤

1. 查询本地代码中 `ForbiddenException` 相关路径，重点查看 report job 执行和 crawler 接入。
2. 查看线上 `hermes-api` 容器日志中该 job 的错误堆栈。
3. 如需要，查询线上任务详情或上下文文件，确认 owner、role、permissions、crawlerPlan 状态。
4. 判断根因并记录可验证证据。
5. 如果是代码缺陷，再补测试并做最小修复；如果是配置/权限数据问题，给出具体修复 SQL 或页面操作建议。

## 验证方式

* 本地代码路径核对。
* 线上容器日志核对。
* 必要时调用受控接口读取任务详情。
* 如修改代码，运行相关测试和 `npx pnpm@9.15.9 build`。
