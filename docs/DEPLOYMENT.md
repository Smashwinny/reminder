# 拾遗多用户云端部署与迁移

## 隔离原则

拾遗只与 ISAW 共用 ECS 主机，不共用代码目录、Compose 项目、Docker 网络、数据卷、数据库账号或密钥：

- Compose 项目固定为 `reminder`；容器为 `reminder_app`。
- 数据只写入命名卷 `reminder_data`。
- 服务只绑定宿主机 `127.0.0.1:8787`，由 Nginx/Cloudflare 反向代理；不得直接暴露公网端口。
- 容器有独立网络、384 MiB 内存和 0.75 CPU 上限，不加入 ISAW 网络。
- `deploy/.env` 独立且不进 Git，禁止复制 ISAW 的 JWT、数据库、OSS 或短信密钥。
- Kimi 使用拾遗自己的 Key，并通过 `KIMI_DAILY_SUMMARY_LIMIT` 限制每位用户每日新摘要数，避免一个项目耗尽其他项目预算。
- Kimi Key 单独放在权限为 `0600` 的 `deploy/kimi.key`，只读挂载进拾遗容器；不会写入镜像、APK、Git 或 ISAW 环境文件。

## 首次部署

```bash
cp deploy/.env.example deploy/.env
# 编辑 deploy/.env，至少换成一个长随机邀请码
docker compose -f deploy/docker-compose.yml up -d --build
curl http://127.0.0.1:8787/api/healthz
```

也可以运行 `deploy/install.sh`：它会先检查 Compose、`reminder_app` 和 8787 端口，只创建拾遗资源；发现冲突就停止，不会停止、重启或加入 ISAW 容器网络。反向代理模板见 `deploy/nginx-reminder.conf.example`，应用前仍需按服务器证书方式调整并执行 `nginx -t`。

反向代理只需把 `https://reminder.geniusqi.com` 转发到 `http://127.0.0.1:8787`。TLS 在 Cloudflare 或 Nginx 终止，公网只开放 80/443；PostgreSQL、Redis、MinIO 和 8787 均不得直接开放。

如果沿用固定 Cloudflare Tunnel，可使用 `deploy/reminder-tunnel.service`。连接器二进制和 token 分别放在 `/opt/reminder/bin/cloudflared` 与 `/opt/reminder/deploy/cloudflare-tunnel-token`；token 权限为 `0640 root:nogroup`，服务以 `nobody` 用户和只读系统保护运行。更换服务器时在新机启动同一服务、验证域名后再停止旧连接器，无需改变 App 地址。

Android 正式版拒绝明文 HTTP，并关闭系统应用数据云备份，防止会话令牌被复制到非预期备份。新服务器必须先配置有效 HTTPS，不能把公网 `http://IP:8787` 直接交给用户。

## 旧版个人数据迁移

1. 旧版手机先做最后一次同步，保留原始 `sync-server/data/tasks.json`。
2. 部署新版并用邀请码注册你的账号。
3. 把旧文件复制进独立数据卷，再执行一次性迁移：

```bash
docker cp sync-server/data/tasks.json reminder_app:/data/tasks.json
docker compose -f deploy/docker-compose.yml exec app node migrate-legacy.js 你的用户名
```

迁移器不会删除旧文件；如果目标账号已经有云端任务，它会停止而不是覆盖。迁移完成后手机登录同一账号并双向同步，任务 ID、状态、查看次数、提醒和摘要都会保留。本地 `content://` 附件仍需由原手机重新上传。

如果手机里已经包含全部旧任务，也可以直接在新版 App 注册第一个账号：App 会把原先未归属的本地任务认领到该账号并首次上传。之后切换账号时，每个账号使用独立本地存储，不会把 A 的任务上传给 B。

## 备份、恢复和换服务器

创建带 SHA-256 校验的便携备份：

```bash
deploy/backup.sh
```

生产服务器使用 `reminder-backup.timer` 每天自动备份并保留 14 天。备份仍应定期复制到另一台机器或私有对象存储；只有同机副本不能抵御整盘损坏。

换服务器只需复制以下内容：

- Git 仓库（不含运行数据）
- `deploy/.env`（通过安全渠道单独复制）
- `backups/reminder-data-*.tar.gz` 及其 `.sha256`

新服务器安装 Docker 后：

```bash
cp deploy/.env.example deploy/.env   # 或安全复制原配置
deploy/restore.sh backups/reminder-data-时间.tar.gz
curl http://127.0.0.1:8787/api/healthz
```

恢复包包含用户、密码哈希、会话和每个用户的独立任务目录，不依赖 ISAW 或特定云厂商。域名只需重新指向新入口。建议每天备份并把备份同步到另一台机器或私有 OSS；同盘备份不能防止磁盘故障。

## 数据边界

```text
/data/users.json                 用户与 scrypt 密码哈希
/data/sessions.json              SHA-256 后的会话令牌
/data/users/<随机用户UUID>/tasks.json
```

客户端永远不能提交或选择 `userId`。后端根据 Bearer 会话找到用户，再由服务端拼出用户目录，因此一个账号无法读取另一个账号的数据文件。原始令牌和明文密码不会写入服务端数据。

## 上线检查

```bash
docker compose -f deploy/docker-compose.yml config
docker compose -f deploy/docker-compose.yml ps
curl -fsS http://127.0.0.1:8787/api/healthz
node --test sync-server/server.test.js
deploy/verify-portability.sh
deploy/verify-live-isolation.sh
```

还需在阿里云安全组确认公网仅开放所需的 80/443 和受限 SSH。服务器在线资源、安全组以及真实备份恢复必须在取得服务器登录权限后验证，不能由代码检查替代。
