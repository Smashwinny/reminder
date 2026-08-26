# 渐明电脑同步端

任意网络同步时，Ubuntu 终端输入：

```bash
reminder internet
```

首次运行会自动下载 Cloudflare 的 `cloudflared` 连接组件，然后显示随机 HTTPS 公网地址和高强度同步密钥。手机与电脑无需处于同一网段。

```text
手机公网同步地址：https://随机地址.trycloudflare.com
同步密钥：一串随机字符
```

把这两项粘贴到手机 App 的同步对话框即可。电脑网页仍在 `http://localhost:8787` 打开，首次使用也会询问同步密钥，网页源码不包含密钥。

如果终端已经关闭或忘记同步信息，随时输入：

```bash
reminder code
```

其他命令：

```bash
reminder status
reminder code       # 显示当前手机同步地址和密钥
reminder stop
reminder            # 仅使用同一局域网时
```

未安装命令时，也可以在项目目录直接运行：

```bash
SYNC_CODE=654321 node sync-server/server.js
```

手机在任意网络下点击“同步”，填写 `reminder internet` 输出的地址和密钥。可选择：

- 双向同步：两端按 `updatedAt` 取较新的任务状态
- 仅上传：只把手机的新增和更新合入电脑同步库
- 仅接收：只把电脑同步库的新内容合入手机，不覆盖手机上时间更新的内容

数据保存在 `sync-server/data/tasks.json`，该目录已加入 `.gitignore`。

## 当前公网版本的限制

当前使用 Cloudflare Quick Tunnel，无需注册账号，适合这一开发阶段。电脑必须开机且 `reminder internet` 服务正在运行；隧道重启后公网地址可能改变，需要把新地址重新粘贴到手机。正式长期版本应迁移到固定域名的命名隧道或云端同步服务。同步数据仍保存在本机，不上传到 Cloudflare 存储。

## Kimi 链接摘要

任务正文只有一个公开网页链接时，电脑端会自动排队读取网页，并调用 Kimi K3 生成中文标题和摘要。网页会自动刷新处理中的摘要；手机下次同步时会收到结果。

默认只读密钥文件为 `/home/hulk/token_api/kimicode`，不会写入该文件，也不会把密钥保存进项目或同步数据。可以通过环境变量覆盖配置：

```bash
KIMI_API_KEY_FILE=/安全路径/key KIMI_MODEL=k3 reminder
```

为避免误访问局域网设备，摘要服务拒绝 localhost、内网 IP、带账号密码的 URL 和非网页内容；抓取有超时与大小限制，并按单任务队列处理。
