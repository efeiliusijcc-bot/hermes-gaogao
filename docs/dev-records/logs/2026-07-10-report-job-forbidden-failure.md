# 开发记录：report-job-forbidden-failure

## 完成内容

本次排查了用户在报告任务详情页看到 `Forbidden Exception` 的原因。失败任务的数据库召回已经成功，资料采集也按配置跳过，真正失败点是后台执行报告任务时丢失了创建者的自定义角色权限。

已修复：创建报告任务时保存当前用户的角色、模块和权限快照；后台执行任务时用该快照恢复任务创建者身份，避免 `viewer + 自定义编报角色` 被降级为纯 viewer 后无法继续读取拟稿助手规划。

## 实际改动文件

* `server/types.ts`：在 `JobRecord` 中新增 `ownerRoles`、`ownerModules`、`ownerPermissions`，用于持久化任务创建时的权限快照。
* `server/reports.service.ts`：`createJob` 写入创建者角色/模块/权限快照；新增后台任务 owner 恢复逻辑；`runJob` 调用拟稿助手上下文增强时使用恢复后的完整权限用户。
* `tests/account-permissions.test.ts`：新增测试，覆盖 `viewer` 基础角色绑定自定义角色后仍能通过任务权限快照保留 `report:create`。

## 关键行为决策

* 不修改用户当前角色配置，也不改 RBAC 映射表；本次只修复报告任务执行时的权限恢复问题。
* 任务创建时保存权限快照，而不是后台执行时重新查数据库。这样任务执行逻辑更稳定，也避免角色后续变更导致已提交任务中途权限漂移。
* 老任务如果没有权限快照，仍按旧的 `ownerRole` 兜底恢复身份。旧失败任务不会自动修复，需要用户重新创建任务或后续单独做任务重跑能力。

## 验证结果

* `npx tsx tests/account-permissions.test.ts`：通过。
* `npx tsx tests/crawler-report-integration.test.ts`：通过。
* `npx pnpm@9.15.9 build`：通过。
* `bash deploy.sh`：通过，`hermes-api` 容器启动成功，`/api/hermes/health`、`/api/auth/me`、`/api/vector-sources/status` 检查通过。

## 额外操作

* 本次未涉及数据库迁移。
* 本次未新增依赖。
* 本次未修改环境变量。
* 本次已提交并部署到云节点，部署脚本完成 Docker 构建、数据库初始化、容器重启和健康检查。

## 已知风险

* 已经失败的旧任务文件中没有 `ownerPermissions`，不会自动恢复成功。
* 如果未来要求“角色变更立即影响排队中的任务”，需要重新评估权限快照策略。
* 本次验证覆盖了权限快照和资料采集回归，但没有在浏览器里重新完整生成一篇线上报告，部署后建议用 `user1 / test1` 再创建一次编报任务做线上验收。

## 后续排查入口

如果后续仍出现报告任务 `Forbidden Exception`，优先检查：

1. 对应任务 JSON 中是否包含 `ownerRoles`、`ownerModules`、`ownerPermissions`。
2. `ownerPermissions` 是否包含 `report:create`。
3. `server/reports.service.ts` 中 `runJob` 是否使用 `buildJobOwnerUser(job)`。
4. 失败是否发生在 `loadDraftAssistantPlanBundle` 的 owner 校验，而不是权限校验。
5. 线上部署版本是否已经包含本次提交。
