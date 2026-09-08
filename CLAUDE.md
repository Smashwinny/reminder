# 拾遗（Reminder）项目协作规则

> 背景：2026-09-04 发生过账号认证数据丢失事故（详见
> [docs/POSTMORTEM-20260904-auth-data-loss.md](docs/POSTMORTEM-20260904-auth-data-loss.md)）。
> 以下规则由该事故总结而来，所有智能体在本项目工作时必须遵守。

## 部署与发布红线

1. **破坏性变更（认证方式、同步协议、数据格式）未在真实运行实例上完成迁移和端到端验证前，
   禁止推送 OTA / 发布客户端。** 验证必须针对 `https://reminder.geniusqi.com` 真实环境，
   只在 `tmp/` 临时目录里跑测试不算数。
2. **代码新增必填环境变量时，必须同步更新所有运行入口并验证生效：**
   - 生产服务：阿里云 `/opt/reminder/deploy/.env` 及 Docker Compose（本机旧服务已停用）
   - `deploy/docker-compose.yml`、`deploy/install.sh` 等部署脚本
   - 验证方法：重启服务后直接请求对应端点，确认不再是"未配置"类报错。
3. **新增持久化数据文件时，必须同步加入 `bin/reminder` 的 `make_backup` 备份范围。**
   账号数据（`users.json`、`sessions.json`、`users/`）与任务数据同等重要。
4. **过渡期保持向后兼容**：替换认证/协议时，旧方式至少保留一个版本周期，
   确认所有客户端迁移完成后再移除。
5. **日志只滚动追加，禁止启动时清空**（启动清空已修复）。
6. **同一公网隧道不能连接两个独立数据目录。** 本机 `deploy/CLOUD_PRODUCTION` 是防误启动保护，不得删除来解决同步故障。开发测试用独立数据和非公网端口。

## 环境速查

- 生产服务 = 阿里云 `/opt/reminder` → Docker `reminder_app`，端口仅 `127.0.0.1:8787`，数据卷 `reminder_data` 挂载 `/data`。
- 本机 `reminder-autostart.service` 已禁用；`sync-server/data/` 只保留历史备份，不是正式数据源。不得恢复旧公网入口。
- 公网入口：Cloudflare 命名隧道 `reminder.geniusqi.com`
- 注册邀请码通过云端 `deploy/.env` 的 `REGISTRATION_INVITE_CODE` 配置；本机旧邀请码不是生产依据。
- 工具必须在云端容器运行，例如 `docker exec reminder_app node create-reset-link.js <用户名>`。不要在本机重建同名账号。
- 备份：云端 `/opt/reminder/deploy/backup.sh`；迁移兼容账号通过 `aliasOf` 指向唯一任务库，不能按用户名自行合并其他用户。
