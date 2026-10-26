import test from "node:test";
import assert from "node:assert/strict";
import { formMcpConfig, parseMcpJson, serializeMcpJson, validateMcpConnection } from "./mcpConfig";

const parse = (value: unknown) => parseMcpJson(JSON.stringify(value));

test("imports a named HTTP server and separates its Bearer credential from public config", () => {
  const result = parse({ mcpServers: { docs: { type: "streamable-http", url: "https://example.com/mcp", headers: { authorization: "Bearer private-token" } } } });
  assert.equal(result.name, "docs");
  assert.equal(result.token, "private-token");
  assert.deepEqual(result.config, { transport: "http", url: "https://example.com/mcp" });
  assert.ok(!JSON.stringify(result.config).includes("private-token"));
});

test("round trips pending stdio arguments, working directory and environment without exporting grants", () => {
  const config = formMcpConfig({ transport: "stdio", command: "C:\\tools\\server.exe", cwd: "C:\\docs", trustedStdio: true, enabledTools: ["write"], environmentKeys: ["SAVED_KEY"] }, '["--path", "a b", "中文"]', '{"API_KEY":"pending-key"}');
  const text = serializeMcpJson("Local docs", "Notes", config, "");
  const result = parseMcpJson(text);
  assert.deepEqual(result.config.args, ["--path", "a b", "中文"]);
  assert.deepEqual(result.config.env, { API_KEY: "pending-key" });
  assert.equal(result.config.cwd, "C:\\docs");
  assert.equal(result.name, "Local docs");
  assert.equal(result.description, "Notes");
  for (const field of ["trustedStdio", "enabledTools", "environmentKeys", "SAVED_KEY"]) assert.ok(!text.includes(field));
});

test("distinguishes keeping saved environment values from explicitly clearing them", () => {
  const config = { transport: "stdio", command: "/usr/bin/server", env: { OLD: "stale" } };
  assert.ok(!Object.hasOwn(formMcpConfig(config, "[]", ""), "env"));
  assert.deepEqual(formMcpConfig(config, "[]", "{}").env, {});
});

test("rejects malformed JSON, invalid containers, multiple servers and unsupported options", () => {
  for (const value of ["{", "[]", "null", '"text"']) assert.throws(() => parseMcpJson(value));
  for (const value of [
    { mcpServers: {} },
    { mcpServers: { a: { url: "http://localhost/mcp" }, b: { url: "http://localhost/mcp" } } },
    { mcpServers: { a: null } },
    { url: "http://localhost/mcp", timeout: 5000 },
    { command: "/bin/server", trustedStdio: true },
    { type: "sse", url: "http://localhost/mcp" },
    { type: ["http"], url: "http://localhost/mcp" },
    { type: "stdio", transport: "http", url: "http://localhost/mcp" },
    { url: "http://localhost/mcp", command: "/bin/server" },
  ]) assert.throws(() => parse(value));
});

test("rejects headers that would otherwise be silently lost or leak secrets", () => {
  for (const headers of [{ "X-API-Key": "secret" }, { Authorization: "Basic secret" }, { Authorization: "Bearer " }, { Authorization: "Bearer secret\r\nInjected: value" }, { Authorization: 1 }]) {
    assert.throws(() => parse({ url: "https://example.com/mcp", headers }), (error: Error) => !error.message.includes("secret"));
  }
});

test("validates argument and environment types before saving from either mode", () => {
  for (const args of [null, "--flag", [1], Array(101).fill("arg")]) assert.throws(() => parse({ command: "/bin/server", args }));
  for (const env of [null, [], { PORT: 8000 }, { "": "value" }, { "A=B": "value" }]) assert.throws(() => parse({ command: "/bin/server", env }));
  assert.throws(() => formMcpConfig({ transport: "stdio" }, "invalid", ""));
  assert.throws(() => formMcpConfig({ transport: "stdio" }, "[]", '{"PORT":8000}'));
});

test("keeps omitted credentials separate and clears removed optional stdio fields", () => {
  const saved = { transport: "http", url: "https://example.com/mcp", environmentKeys: ["SAVED"] };
  const result = parseMcpJson(serializeMcpJson("Remote", "", saved, ""));
  assert.equal(result.token, undefined);
  assert.ok(!Object.hasOwn(result.config, "env"));
  assert.equal(parse({ command: "/bin/server" }).config.cwd, "");
  assert.deepEqual(parse({ command: "/bin/server", env: {} }).config.env, {});
});

test("requires supported URLs, an absolute executable and explicit stdio trust", () => {
  for (const url of ["relative", "ftp://example.com", "https://user:pass@example.com/mcp", "https://example.com/mcp?token=secret"]) {
    assert.throws(() => validateMcpConnection({ transport: "http", url }));
  }
  validateMcpConnection({ transport: "http", url: "https://example.com/mcp" });
  assert.throws(() => validateMcpConnection({ transport: "stdio", command: "npx", trustedStdio: true }));
  assert.throws(() => validateMcpConnection({ transport: "stdio", command: "/bin/server", trustedStdio: false }));
  for (const command of ["/bin/server", "C:\\tools\\server.exe", "\\\\host\\share\\server.exe"]) validateMcpConnection({ transport: "stdio", command, trustedStdio: true });
});
