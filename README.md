# 渐明

一款以颜色深浅呈现任务状态的轻量 Android 提醒应用。

## 第一版功能

- 粘贴或输入内容，立即记录任务
- 新任务颜色最深；查看、进行中、完成分别呈现不同深浅
- 按颜色、创建时间、提醒时间排序
- 设置系统通知提醒
- 完成、恢复与删除任务
- 使用本地 SharedPreferences 持久保存，重启应用不会丢失

## 构建

```bash
./gradlew assembleDebug
```

APK 输出：`app/build/outputs/apk/debug/app-debug.apk`
