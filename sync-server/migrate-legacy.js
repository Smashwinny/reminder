#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
const username = process.argv[2];
if (!username) { console.error("用法：node sync-server/migrate-legacy.js <用户名>"); process.exit(2); }
const users = JSON.parse(fs.readFileSync(path.join(dataDir, "users.json"), "utf8"));
const user = users.find(item => item.username.toLowerCase() === username.toLowerCase());
if (!user) { console.error("找不到该用户，请先完成账号注册"); process.exit(2); }
const source = path.join(dataDir, "tasks.json");
if (!fs.existsSync(source)) { console.error("没有找到旧版 tasks.json"); process.exit(2); }
const tasks = JSON.parse(fs.readFileSync(source, "utf8"));
if (!Array.isArray(tasks)) { console.error("旧数据格式不是任务数组"); process.exit(2); }
const targetDir = path.join(dataDir, "users", user.id);
const target = path.join(targetDir, "tasks.json");
if (fs.existsSync(target) && JSON.parse(fs.readFileSync(target, "utf8")).length) {
  console.error("目标账号已有云端任务，为避免覆盖已停止；请先人工合并"); process.exit(3);
}
fs.mkdirSync(targetDir, { recursive: true });
fs.writeFileSync(target, JSON.stringify(tasks, null, 2), { mode: 0o600 });
console.log(`迁移完成：${tasks.length} 条任务已归属账号 ${user.username}`);
console.log(`旧文件保留：${source}`);
