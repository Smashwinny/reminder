const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const testRoot = path.resolve(__dirname, "../tmp");
fs.mkdirSync(testRoot, { recursive: true });
process.env.DATA_DIR = fs.mkdtempSync(path.join(testRoot, "multi-user-test-"));
process.env.REGISTRATION_INVITE_CODE = "test-invite-9284";
const { mergeTasks, onlyUrl, privateAddress, createServer } = require("./server");

test("merge keeps independently created tasks", () => {
  const merged = mergeTasks(
    [{ id: "phone", text: "手机任务", createdAt: 1, updatedAt: 1 }],
    [{ id: "desktop", text: "电脑任务", createdAt: 2, updatedAt: 2 }]
  );
  assert.deepEqual(merged.map(task => task.id), ["desktop", "phone"]);
});

test("newest task state wins while newest summary is preserved", () => {
  const merged = mergeTasks(
    [{ id: "same", text: "任务", state: 0, createdAt: 1, updatedAt: 10, summary: "旧摘要", summaryUpdatedAt: 30 }],
    [{ id: "same", text: "任务", state: 3, createdAt: 1, updatedAt: 20, summary: "", summaryUpdatedAt: 0 }]
  );
  assert.equal(merged[0].state, 3);
  assert.equal(merged[0].summary, "旧摘要");
});

test("newest attention and attachment metadata survive sync merge", () => {
  const merged = mergeTasks(
    [{ id: "same", text: "灵感", createdAt: 1, updatedAt: 10, viewCount: 1 }],
    [{ id: "same", text: "灵感", createdAt: 1, updatedAt: 20, viewCount: 4,
      lastViewedAt: 19, attachmentType: "image", attachmentName: "灵感.png",
      attachmentUri: "content://local/image" }]
  );
  assert.equal(merged[0].viewCount, 4);
  assert.equal(merged[0].lastViewedAt, 19);
  assert.equal(merged[0].attachmentName, "灵感.png");
});

test("URL and private-network guards reject unsafe inputs", () => {
  assert.equal(onlyUrl("https://example.com/article").hostname, "example.com");
  assert.equal(onlyUrl("https://example.com two"), null);
  assert.equal(privateAddress("127.0.0.1"), true);
  assert.equal(privateAddress("192.168.1.10"), true);
  assert.equal(privateAddress("8.8.8.8"), false);
});

async function post(base, route, body, token) {
  return fetch(base + route, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
}

test("accounts require invite and each user sees only their own tasks", async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const rejected = await post(base, "/api/auth/register", { username: "wrong_user", password: "password-123", inviteCode: "wrong" });
    assert.equal(rejected.status, 400);
    const first = await (await post(base, "/api/auth/register", { username: "first_user", password: "password-123", inviteCode: process.env.REGISTRATION_INVITE_CODE })).json();
    const second = await (await post(base, "/api/auth/register", { username: "second_user", password: "password-456", inviteCode: process.env.REGISTRATION_INVITE_CODE })).json();
    const unauthorized = await post(base, "/api/sync", { mode: "download", tasks: [] });
    assert.equal(unauthorized.status, 401);
    await post(base, "/api/sync", { mode: "upload", tasks: [{ id: "private-a", text: "仅用户A", createdAt: 1, updatedAt: 1 }] }, first.token);
    await post(base, "/api/sync", { mode: "upload", tasks: [{ id: "private-b", text: "仅用户B", createdAt: 1, updatedAt: 1 }] }, second.token);
    const firstTasks = (await (await post(base, "/api/sync", { mode: "download", tasks: [] }, first.token)).json()).tasks;
    const secondTasks = (await (await post(base, "/api/sync", { mode: "download", tasks: [] }, second.token)).json()).tasks;
    assert.deepEqual(firstTasks.map(item => item.id), ["private-a"]);
    assert.deepEqual(secondTasks.map(item => item.id), ["private-b"]);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("desktop page exposes search, completed section and progressive attention UI", async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/`);
    const html = await response.text();
    assert.match(html, /id="search"/);
    assert.match(html, /id="completed"/);
    assert.match(html, /viewCount/);
    assert.match(html, /久置落灰/);
    assert.match(html, /width:28px/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
