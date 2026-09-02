# Android OTA 复用交接手册

这是当前仓库 Android 站外 OTA 的唯一交接入口。其他 Codex 接手任意 Android 项目时，先完整阅读本文件，再检查目标项目；不要直接复制拾遗的包名、签名密钥或版本号。

## 能复用什么

服务端按 App 隔离发布：

```text
https://<官方域名>/releases/<app-slug>/stable.json
https://<官方域名>/releases/<app-slug>/<app-slug>-<versionName>.apk
```

清单协议固定为：

```json
{
  "applicationId": "com.example.app",
  "versionCode": 12,
  "versionName": "1.2.0",
  "apkUrl": "https://example.com/releases/example/example-1.2.0.apk",
  "sha256": "64位小写SHA-256",
  "size": 1234567,
  "notes": "更新说明",
  "required": false,
  "publishedAt": "2026-09-02T00:00:00Z"
}
```

客户端安全边界：只接受 HTTPS；APK 必须与清单同域名；`applicationId` 必须等于当前安装包；下载到 App 私有外部目录；SHA-256 一致后才交给 Android 系统安装器。系统安装器继续校验包名、版本递增和签名证书。

## 复用源文件

- 通用 Java 客户端：[UpdateChecker.java](../app/src/main/java/com/smashwinny/reminder/UpdateChecker.java)
- FileProvider 路径：[update_paths.xml](../app/src/main/res/xml/update_paths.xml)
- Manifest 示例：[AndroidManifest.xml](../app/src/main/AndroidManifest.xml)
- 通用发布器：[publish-release.sh](../tools/android-ota/publish-release.sh)
- 服务端发布路由：[server.js](../sync-server/server.js)

`UpdateChecker` 除第一行 `package` 外不依赖拾遗业务。它的应用名、清单地址和检查周期全部由 `Config` 注入。

## 其他 Codex 的执行步骤

### 1. 先审计目标项目

必须确认并记录：

- 技术栈：原生 Java、Kotlin/Compose 或 React Native。
- `applicationId`、当前 `versionCode`、`versionName`。
- 启动 Activity 和 `onResume` 所在位置。
- 是否已有 FileProvider，以及 authorities 是否冲突。
- 是否已有长期正式 release keystore。不得用 debug key 发布正式 OTA。
- 工作树是否有用户未提交修改；不得覆盖无关改动。

每个 App 使用独立的长期签名密钥。绝对不要复制或共用拾遗的 keystore。

### 2. 接入客户端

原生 Java：

1. 将 `UpdateChecker.java` 复制到目标 App 的源代码包目录，只修改 `package` 行。
2. 将 `update_paths.xml` 放入目标 App 的 `res/xml/`；若已有 FileProvider，合并路径而不是注册第二个冲突 Provider。
3. 确保依赖包含 `androidx.core:core`。
4. 在 Manifest 增加：

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />

<provider
    android:name="androidx.core.content.FileProvider"
    android:authorities="${applicationId}.updates"
    android:exported="false"
    android:grantUriPermissions="true">
    <meta-data
        android:name="android.support.FILE_PROVIDER_PATHS"
        android:resource="@xml/update_paths" />
</provider>
```

5. 在启动 Activity 的 `onCreate` 调用：

```java
UpdateChecker.checkPeriodically(this, new UpdateChecker.Config(
        "https://<官方域名>/releases/<app-slug>/stable.json",
        "<用户看到的应用名>"));
```

6. 在 `onResume` 调用 `UpdateChecker.resumePendingInstall(this);`，以便用户开启“允许来自此来源”后自动继续。
7. 如需“检查更新”按钮，调用 `UpdateChecker.checkNow(this, config);`。

Kotlin/Compose：等价移植 `UpdateChecker`，保留所有安全检查和 SharedPreferences 状态；从 Activity 生命周期调用，不要把安装 Intent 直接塞进 Composable。也可以先让 Java 文件与 Kotlin 共存，通常改动更小。

React Native：把同一检查器放入 `android/app/src/main/java|kotlin/<包目录>/`，用一个薄 Native Module 暴露 `checkNow`；每日自动检查和 `resumePendingInstall` 仍放在原生 MainActivity 生命周期，避免 JS 尚未启动时丢失安装恢复。不要用普通 JS `fetch + Linking` 替代 SHA-256 和 FileProvider 流程。

### 3. 服务端要求

若继续共用拾遗发布服务，不需要修改服务端代码，只为新 App 使用新的 `<app-slug>` 目录。服务端必须保持 `/releases/<app>/<filename>` 只读公开，并允许 `.json` 与 `.apk`；任务、账号和密钥目录不得暴露。

若迁移到另一台服务器，复制 `server.js` 中 `releaseFile`/发布路由的等价逻辑，或在现有 Web Server 实现相同静态路径与 Content-Type。清单必须 `Cache-Control: no-store`，版本 APK 可以 immutable 缓存。

### 4. 构建与发布

先用目标 App 自己的正式签名密钥构建 APK，再发布。脚本不读取签名密钥：

```bash
tools/android-ota/publish-release.sh \
  <app-slug> <applicationId> <versionCode> <versionName> \
  <正式签名APK路径> '<更新说明>' <ssh-user@server>
```

可选环境变量：

```text
OTA_PUBLIC_BASE_URL         默认 https://reminder.geniusqi.com/releases
OTA_REMOTE_ROOT             默认 /opt/reminder/tmp
OTA_CONTAINER_NAME          默认 reminder_app
OTA_CONTAINER_RELEASE_ROOT  默认 /data/releases
OTA_REQUIRED                true/false，默认 false
OTA_DRY_RUN                 1 时只在当前项目 tmp/ 生成 APK 副本和 stable.json
OTA_SKIP_APK_METADATA_CHECK 1 时跳过 apkanalyzer，仅限工具损坏时的人工应急
```

发布器默认使用 Android SDK 的 `apkanalyzer` 核对 APK 内部包名和版本，参数不一致会拒绝发布。第一次接入先使用 `OTA_DRY_RUN=1` 检查清单，确认包名、版本、URL、哈希和大小，再执行真实上传。

## 必须完成的验收

不能只以“构建成功”作为完成。至少验证：

1. 正式 APK 的包名、`versionCode` 和签名证书正确。
2. 旧版真机保留业务数据，能够发现新版。
3. 下载后的 APK SHA-256 与清单一致。
4. 首次未知来源授权后，返回 App 能继续打开系统安装器。
5. 安装完成后版本号升级，账号和本地数据未丢失。
6. 公网 `stable.json` 返回 200 且不缓存；APK 返回 200 和正确 Content-Type。
7. 下载公开 APK 后再次核对 SHA-256 和签名证书。
8. 提交时不包含 keystore、密码、token、服务器 `.env` 或用户数据。

若没有连接真机，只能报告“代码接入和构建完成，真机 OTA 未验证”，不能声称已交付。

## 回滚

- 客户端有问题：把 `stable.json` 恢复到上一个已验证版本；不要删除用户数据。
- APK 发布错误：先修正或撤回清单，APK 文件可保留用于审计。
- 签名错误：不能通过 OTA 覆盖既有安装；必须找回原正式密钥重新签名。
- 版本号错误：Android 不允许常规降级，重新构建更高 `versionCode`。

## 交给 Codex 的最短指令

```text
请完整阅读 /home/hulk/androidapp/reminder/docs/OTA_REUSE_HANDOFF.md，
按照其中的审计、安全、接入、发布和真机验收步骤，把 OTA 复用到当前项目。
保留当前工作树已有修改，每个 App 使用独立正式签名，不得复制拾遗密钥。
```
