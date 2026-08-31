# 拾遗多用户同步端

当前版本使用邀请码注册、用户名密码登录和 Bearer 会话令牌。每位用户拥有独立任务目录，不再使用全局六位同步码。手机与网页登录同一账号即可同步，详细部署、旧数据迁移和换服务器恢复流程见 [`../docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md)。

本机开发启动：

```bash
REGISTRATION_INVITE_CODE=请替换 node sync-server/server.js
```

以下六位同步码说明仅适用于旧版个人服务，正式多用户部署不要继续开放旧接口。

任意网络同步时，Ubuntu 终端输入：

```bash
reminder internet
```

当前个人版使用 Cloudflare Named Tunnel 和固定地址 `https://reminder.geniusqi.com`，同时显示6位数字同步码。手机与电脑无需处于同一网段。

```text
手机公网同步地址：https://reminder.geniusqi.com
6位同步码：123456
```

把这两项粘贴到手机 App 的同步对话框即可。电脑网页仍在 `http://localhost:8787` 打开，首次使用也会询问同步码，网页源码不包含同步码。公网接口同一来源连续输错5次后会暂停15分钟。

如果终端已经关闭或忘记同步信息，随时输入：

```bash
reminder code
```

其他命令：

```bash
reminder status
reminder code       # 显示当前手机同步地址和6位同步码
reminder stop
reminder            # 仅使用同一局域网时
```

未安装命令时，也可以在项目目录直接运行：

```bash
SYNC_CODE=654321 node sync-server/server.js
```

手机在任意网络下点击“同步”，填写 `reminder internet` 输出的地址和6位同步码。可选择：

- 双向同步：两端按 `updatedAt` 取较新的任务状态
- 手机保存任务后自动同步，打开应用时也会自动接收电脑端修改
- 仅上传：只把手机的新增和更新合入电脑同步库
- 仅接收：只把电脑同步库的新内容合入手机，不覆盖手机上时间更新的内容

数据保存在 `sync-server/data/tasks.json`，该目录已加入 `.gitignore`。服务每天首次写入前会在
`sync-server/data/backups/` 留一份快照，并自动保留最近 14 天。
可使用 `reminder backup` 创建手动快照、`reminder backups` 查看快照，使用
`reminder restore <备份文件>` 在二次确认后恢复。恢复前还会自动保存当前数据。

协议回归测试：

```bash
node --test sync-server/server.test.js
```

## 当前公网版本

当前使用固定域名的 Cloudflare Named Tunnel。电脑必须开机且拾遗自动启动服务正在运行；公网地址不会随隧道重启改变。同步数据仍保存在本机，不上传到 Cloudflare 存储。手机图片和视频附件只同步名称与轻量引用，媒体本体暂不跨设备复制。

## Kimi 链接摘要

任务正文只有一个公开网页链接时，电脑端会自动排队读取网页，并调用 Kimi K3 生成中文标题和摘要。网页会自动刷新处理中的摘要；手机下次同步时会收到结果。

默认只读密钥文件为 `/home/hulk/token_api/kimicode`，不会写入该文件，也不会把密钥保存进项目或同步数据。可以通过环境变量覆盖配置：

```bash
KIMI_API_KEY_FILE=/安全路径/key KIMI_MODEL=k3 reminder
```

为避免误访问局域网设备，摘要服务拒绝 localhost、内网 IP、带账号密码的 URL 和非网页内容；抓取有超时与大小限制，并按单任务队列处理。
