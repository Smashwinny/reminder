const path = require("node:path");
const { createAuthStore } = require("./auth-store");

const username = String(process.argv[2] || "").trim();
const baseUrl = String(process.argv[3] || process.env.PUBLIC_URL || "https://reminder.geniusqi.com").replace(/\/$/, "");
if (!username) {
  console.error("用法：node create-reset-link.js <用户名> [公网地址]");
  process.exit(1);
}

const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, "data");
const result = createAuthStore(dataDir).createPasswordReset(username);
console.log(`${baseUrl}/reset#${result.token}`);
console.log(`有效期至：${new Date(result.expiresAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`);
