# Android OTA 更新约定

跨项目复用与 Codex 交接请以 [OTA_REUSE_HANDOFF.md](OTA_REUSE_HANDOFF.md) 为唯一入口；本页只保留拾遗部署背景。

同一套服务可承载多个 App，每个 App 使用独立目录、包名和签名密钥：

```text
/releases/<app>/stable.json
/releases/<app>/<app>-<version>.apk
```

清单字段：`applicationId`、`versionCode`、`versionName`、`apkUrl`、`sha256`、`size`、`notes`、`required`、`publishedAt`。
客户端只接受自己的包名以及 `https://reminder.geniusqi.com` 下的下载地址。APK 在应用私有下载目录落盘，SHA-256 一致后才交给系统安装器。Android 安装器还会强制校验 APK 包名、递增版本号与签名证书。首次需要用户授权“允许来自此来源的应用”，以后仍保留系统最终安装确认。

当前可复用范围：

- 拾遗：原生 Java，`com.smashwinny.reminder`，已完成端到端 OTA。
- 药物账本：原生 Kotlin/Compose，`com.hulk.pillsapp`，可复用服务、脚本，并把 Java 检查器等价迁移为 Kotlin；当前目录不是独立 Git 仓库，接入前需先确定交付边界。
- Anubis：原生 Java WebView 壳，`com.smashwinny.anubis`，与拾遗最接近，可直接复用检查器；需要先建立正式签名。
- ISAW：React Native，`com.isaw`，可复用服务与清单，客户端需要一个薄原生模块或 React Native 桥；当前仓库另有未提交修改，本轮不改。
- 每个产品必须使用独立的长期 release keystore。不得提交 keystore、密码或服务器 SSH 凭据。

发布前必须先构建正式签名 APK，再运行 `tools/android-ota/publish-release.sh`。脚本只接受已经生成的 APK，不接触签名密钥。

拾遗正式构建从仓库外配置读取签名，不允许把密码写入 Gradle 文件：

```bash
REMINDER_SIGNING_PROPERTIES=/安全目录/keystore.properties ./gradlew assembleRelease
```
