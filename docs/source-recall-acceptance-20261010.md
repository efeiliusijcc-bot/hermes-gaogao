# 召回接口上线验收记录

日期：2026-10-10（北京时间）。

- 服务器：103.143.80.41。
- 独立容器：`hermes-source-recall`，镜像 `hermes-source-recall:20261010-0144`。
- 入口：`POST https://report.test-link.xin/api/external/source-recall`。
- 仅该精确路径由 Nginx 转发至 `127.0.0.1:1557`，原 `/api/` 仍使用 1556。
- 原 API 镜像保持 `hermes-api:event-plan-7a70314`。

## 实际验证

本机通过公网 HTTPS 发起鉴权请求，查询“欧盟贸易政策”、最近 365 天、最多 5 条：

| 项目 | 结果 |
| --- | --- |
| HTTP / 业务状态 | 200 / hit |
| 客户端耗时 | 1251 ms |
| 召回耗时 | 1038 ms |
| 返回信源 | 5 |
| 向量 / 全文 / 标题 / 实体候选数 | 100 / 100 / 50 / 100 |
| 合并候选数 | 50 |
| 召回异常 | 无 |
| 请求标识 | 5deff91f-818a-4647-8782-7e30f844a81b |

无密钥、错误密钥返回 401；正确密钥但缺少主题返回 400。
限流、并发拒绝、服务关闭、请求体上限、不可用及恢复后的降级状态由本地测试覆盖。
最初冷查询达到 5 秒 SQL 上限后，通过现有扩展召回返回信源；修正了此时误报
`unavailable` 的状态映射，保留错误诊断并使用 `fallback`。没有放宽数据库超时。

## 服务保护

- 对比部署前后，`hermes-api`、`hermes`、`todo_postgres`、`my_mysql` 的容器 ID、启动时间、重启次数完全一致。
- 原前端入口和 `/api/hermes/health` 均返回 200，健康状态为 `ready`。
- 新容器 healthy，CPU 上限 0.5、内存上限 384 MiB、只读根文件系统、无宿主报告目录挂载。
- 只读账号 `hermes_source_recall`：非超级用户，最多 2 个连接；向量表 SELECT=true，写权限=false。
- 每条 SQL 最长 5 秒；单并发；10 次/分钟；禁止并行查询工作进程。
- API 和嵌入密钥均未输出到终端或纳入版本控制；服务配置权限为 0600。
- Nginx 配置检查通过后进行了平滑 reload，没有 restart。

## 检查边界

TypeScript 构建、相关 ESLint、git diff 检查和 5 个相关测试文件通过。
从暂存区导出干净代码后再次构建并运行相同测试，以排除对其他未提交修改的依赖。
没有提交真实编报任务，没有进行持续负载测试；共享数据库和嵌入服务仍有资源耦合。
后续扩大流量需先评估容量。未宣称整个业务系统的全量 E2E 已覆盖。

调用说明见 `docs/source-recall-api.md`。服务目录为 `/srv/hermes/source-recall/`，
其中 `nginx-before.conf` 与 `baseline-containers.txt` 保存切换前证据。
