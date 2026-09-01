const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const USER_RE = /^[a-zA-Z0-9_\u4e00-\u9fff.-]{3,32}$/u;

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const next = `${file}.next`;
  fs.writeFileSync(next, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(next, file);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, encoded) {
  const [algorithm, salt, expectedHex] = String(encoded).split(":");
  if (algorithm !== "scrypt" || !salt || !expectedHex) return false;
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function createAuthStore(dataDir, options = {}) {
  const usersFile = path.join(dataDir, "users.json");
  const sessionsFile = path.join(dataDir, "sessions.json");
  const resetTokensFile = path.join(dataDir, "password-reset-tokens.json");
  const inviteCode = String(options.inviteCode || "");
  const sessionTtlMs = Number(options.sessionTtlMs || 30 * 86400_000);

  function read(file) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return []; }
  }
  function publicUser(user) { return { id: user.id, username: user.username, createdAt: user.createdAt }; }
  function cleanUsername(value) { return String(value || "").trim(); }
  function validateCredentials(username, password) {
    if (!USER_RE.test(username)) throw new Error("用户名需为3到32位中文、字母、数字或下划线");
    if (String(password || "").length < 8) throw new Error("密码至少需要8位");
    if (String(password || "").length > 128) throw new Error("密码过长");
  }
  function issueSession(userId) {
    const token = crypto.randomBytes(32).toString("base64url");
    const now = Date.now();
    const sessions = read(sessionsFile).filter(item => item.expiresAt > now);
    sessions.push({ tokenHash: crypto.createHash("sha256").update(token).digest("hex"), userId, createdAt: now, expiresAt: now + sessionTtlMs });
    atomicWrite(sessionsFile, sessions);
    return token;
  }
  function register(usernameValue, password, suppliedInvite) {
    const username = cleanUsername(usernameValue);
    validateCredentials(username, password);
    if (inviteCode.length < 12 || inviteCode === "replace-with-a-long-random-invite") throw new Error("服务器尚未配置安全的注册邀请码");
    const a = Buffer.from(inviteCode); const b = Buffer.from(String(suppliedInvite || ""));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error("邀请码不正确");
    const users = read(usersFile);
    if (users.some(user => user.username.toLowerCase() === username.toLowerCase())) throw new Error("用户名已存在");
    const user = { id: crypto.randomUUID(), username, passwordHash: hashPassword(password), createdAt: Date.now() };
    users.push(user); atomicWrite(usersFile, users);
    return { user: publicUser(user), token: issueSession(user.id) };
  }
  function login(usernameValue, password) {
    const username = cleanUsername(usernameValue);
    const user = read(usersFile).find(item => item.username.toLowerCase() === username.toLowerCase());
    if (!user || !verifyPassword(String(password || ""), user.passwordHash)) throw new Error("用户名或密码错误");
    return { user: publicUser(user), token: issueSession(user.id) };
  }
  function createPasswordReset(usernameValue, ttlMs = 30 * 60_000) {
    const username = cleanUsername(usernameValue);
    const user = read(usersFile).find(item => item.username.toLowerCase() === username.toLowerCase());
    if (!user) throw new Error("用户不存在");
    const token = crypto.randomBytes(32).toString("base64url");
    const now = Date.now();
    const active = read(resetTokensFile).filter(item => item.expiresAt > now && item.userId !== user.id);
    active.push({ tokenHash: crypto.createHash("sha256").update(token).digest("hex"), userId: user.id, createdAt: now, expiresAt: now + ttlMs });
    atomicWrite(resetTokensFile, active);
    return { token, expiresAt: now + ttlMs, user: publicUser(user) };
  }
  function resetPassword(tokenValue, password) {
    const token = String(tokenValue || "");
    if (token.length < 32) throw new Error("重置链接无效或已经使用");
    validateCredentials("reset_user", password);
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const now = Date.now();
    const records = read(resetTokensFile);
    const record = records.find(item => item.tokenHash === tokenHash && item.expiresAt > now);
    if (!record) throw new Error("重置链接无效、已过期或已经使用");
    const users = read(usersFile);
    const user = users.find(item => item.id === record.userId);
    if (!user) throw new Error("用户不存在");
    user.passwordHash = hashPassword(password);
    user.passwordChangedAt = now;
    atomicWrite(usersFile, users);
    atomicWrite(sessionsFile, read(sessionsFile).filter(item => item.userId !== user.id && item.expiresAt > now));
    atomicWrite(resetTokensFile, records.filter(item => item.tokenHash !== tokenHash && item.expiresAt > now));
    return { user: publicUser(user), token: issueSession(user.id) };
  }
  function authenticate(header) {
    const token = String(header || "").match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return null;
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const now = Date.now();
    const session = read(sessionsFile).find(item => item.tokenHash === tokenHash && item.expiresAt > now);
    if (!session) return null;
    const user = read(usersFile).find(item => item.id === session.userId);
    return user ? publicUser(user) : null;
  }
  function logout(header) {
    const token = String(header || "").match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return;
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    atomicWrite(sessionsFile, read(sessionsFile).filter(item => item.tokenHash !== tokenHash));
  }
  return { register, login, createPasswordReset, resetPassword, authenticate, logout, usersFile };
}

module.exports = { createAuthStore, hashPassword, verifyPassword, atomicWrite };
