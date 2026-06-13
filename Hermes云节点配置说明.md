# Hermes 云节点配置说明

## 服务器信息

| 项目 | 值 |
|---|---|
| IP | `74.121.148.204` |
| SSH 端口 | `22` |
| SSH 用户 | `root` |
| 部署方式 | Docker |

## 容器信息

| 容器 | 镜像 | 端口/用途 |
|---|---|---|
| `hermes` | `nousresearch/hermes-agent:latest` | Hermes agent 服务 |
| `todo_postgres` | `pgvector/pgvector:pg15-trixie` | `5432:5432`，pgvector 数据库 |

## 本地环境变量

把实际 token 和数据库密码只放在本机或服务器 `.env`，不要提交到 GitHub。

```env
HERMES_BASE_URL=http://74.121.148.204:1888/v1
HERMES_API_KEY=
HERMES_MODEL=hermes/report-agent
HERMES_QA_AGENT_ID=qa-agent
HERMES_QA_MODEL=hermes/qa-agent
HERMES_QA_MODE=direct_pg

PGVECTOR_DATABASE_URL=
```

## 常用检查命令

```bash
ssh -i ~/.ssh/id_ed25519 root@74.121.148.204
docker ps | grep hermes
docker ps | grep todo_postgres
docker logs hermes
docker restart hermes
```
