# Hermes 云节点配置说明

## 服务器

| 项目 | 值 |
|---|---|
| IP | `74.121.148.204` |
| SSH 用户 | `root` |
| 部署方式 | Docker |

## 容器

| 容器 | 镜像 | 说明 |
|---|---|---|
| `hermes` | `nousresearch/hermes-agent:latest` | Hermes Agent CLI/Gateway 容器，当前未暴露 HTTP 端口 |
| `openclaw` | `alpine/openclaw:latest` | Legacy OpenClaw 网关，暴露 `1888->18789` |
| `todo_postgres` | `pgvector/pgvector:pg15-trixie` | pgvector 数据库，暴露 `5432` |

`http://74.121.148.204:1888/v1` 是 OpenClaw 兼容 HTTP 入口，不是 Hermes 容器。

## Hermes 路径

Hermes 容器挂载：

```text
宿主机 /opt/hermes -> 容器内 /opt/data
```

从 OpenClaw 迁移的 report-agent skills：

```text
宿主机 /opt/hermes/workspace/report-agent/skills
容器内 /opt/data/workspace/report-agent/skills
```

已注册到 Hermes 全局 skills：

```text
宿主机 /opt/hermes/skills/reporting
容器内 /opt/data/skills/reporting
```

报告输出目录：

```text
宿主机 /opt/hermes/workspace/report-agent/reports
容器内 /opt/data/workspace/report-agent/reports
```

## 本地后端推荐配置

```env
HERMES_RUN_MODE=remote_cli
HERMES_REMOTE_HOST=74.121.148.204
HERMES_REMOTE_USER=root
HERMES_REMOTE_SSH_KEY=~/.ssh/id_ed25519
HERMES_REMOTE_REPORT_DIR=/opt/hermes/workspace/report-agent/reports
HERMES_REMOTE_CONTAINER_REPORT_DIR=/opt/data/workspace/report-agent/reports
HERMES_CONTAINER_REPORT_DIR=/opt/data/workspace/report-agent/reports
HERMES_REMOTE_CLI_CONTAINER=hermes
HERMES_REMOTE_CLI_BINARY=/opt/hermes/.venv/bin/hermes
HERMES_REMOTE_CLI_HOME=/opt/data
```

模型密钥、数据库密码和 `.env` 只保存在本地或服务器，不提交到 GitHub。
