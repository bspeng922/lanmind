import { tr } from "../../i18n/core";

export interface McpConnectionConfig {
  name?: string;
  description?: string;
  config: Record<string, unknown>;
  token?: string;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function readObject(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    if (isObject(value)) return value;
  } catch { /* Report a localized error without echoing credentials. */ }
  throw new Error(tr("ai:v2.invalidJson"));
}

function invalidField(field: string): never {
  throw new Error(tr("ai:v2.mcpInvalidField", { field }));
}

function argumentsArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100 || value.some((v) => typeof v !== "string")) {
    invalidField("args");
  }
  return value as string[];
}

function environmentObject(value: unknown): Record<string, string> {
  if (!isObject(value) || Object.entries(value).some(([key, v]) =>
    !key || key.length > 100 || key.includes("=") || key.includes("\0") ||
    typeof v !== "string" || v.length > 16384 || v.includes("\0"),
  )) invalidField("env");
  return value as Record<string, string>;
}

export function formMcpConfig(
  config: Record<string, unknown>, argsText: string, environment: string,
): Record<string, unknown> {
  // An omitted environment keeps the saved secret; an empty object clears it.
  const { env: _env, ...connection } = config;
  if (config.transport !== "stdio") return connection;
  let args: unknown;
  try { args = JSON.parse(argsText); } catch { invalidField("args"); }
  return {
    ...connection,
    args: argumentsArray(args),
    ...(environment.trim() ? { env: environmentObject(readObject(environment)) } : {}),
  };
}

export function parseMcpJson(text: string): McpConnectionConfig {
  let server = readObject(text);
  let serverName: string | undefined;
  if (Object.hasOwn(server, "mcpServers")) {
    if (Object.keys(server).some((key) => key !== "mcpServers")) {
      throw new Error(tr("ai:v2.mcpUnsupportedFields"));
    }
    if (!isObject(server.mcpServers) || Object.keys(server.mcpServers).length !== 1) {
      throw new Error(tr("ai:v2.mcpOneServer"));
    }
    const [name, value] = Object.entries(server.mcpServers)[0];
    if (!isObject(value)) invalidField("mcpServers");
    serverName = name;
    server = value;
  }
  const allowed = ["name", "description", "type", "transport", "url", "command", "args", "cwd", "env", "headers"];
  if (Object.keys(server).some((key) => !allowed.includes(key))) {
    throw new Error(tr("ai:v2.mcpUnsupportedFields"));
  }
  for (const field of ["name", "description", "url", "command", "cwd"]) {
    if (Object.hasOwn(server, field) && typeof server[field] !== "string") invalidField(field);
  }
  const normalizeTransport = (value: unknown) => {
    if (typeof value !== "string") invalidField("transport");
    if (["http", "streamable-http", "streamable_http"].includes(value)) return "http";
    if (value === "stdio") return "stdio";
    invalidField("transport");
  };
  const transport = server.transport !== undefined ? normalizeTransport(server.transport)
    : server.type !== undefined ? normalizeTransport(server.type)
    : server.url !== undefined ? "http" : server.command !== undefined ? "stdio" : invalidField("transport");
  if (server.type !== undefined && normalizeTransport(server.type) !== transport) invalidField("type");
  const config: Record<string, unknown> = { transport };
  let token: string | undefined;
  if (transport === "http") {
    if (server.command !== undefined || server.args !== undefined || server.cwd !== undefined || server.env !== undefined) {
      invalidField("command / args / cwd / env");
    }
    config.url = server.url ?? "";
    if (server.headers !== undefined) {
      if (!isObject(server.headers)) invalidField("headers");
      for (const [key, value] of Object.entries(server.headers)) {
        if (key.toLowerCase() !== "authorization" || token !== undefined || typeof value !== "string") {
          throw new Error(tr("ai:v2.mcpBearerOnly"));
        }
        const match = /^Bearer[ \t]+([^\r\n]+)$/i.exec(value);
        if (!match || !match[1].trim()) throw new Error(tr("ai:v2.mcpBearerOnly"));
        token = match[1].trim();
      }
    }
  } else {
    if (server.url !== undefined || server.headers !== undefined) invalidField("url / headers");
    config.command = server.command ?? "";
    config.args = argumentsArray(server.args === undefined ? [] : server.args);
    config.cwd = server.cwd ?? "";
    if (server.env !== undefined) config.env = environmentObject(server.env);
  }
  return {
    name: (server.name as string | undefined) ?? serverName,
    description: server.description as string | undefined,
    config,
    token,
  };
}

export function serializeMcpJson(
  name: string, description: string, config: Record<string, unknown>, token: string,
): string {
  const connection = config.transport === "stdio" ? {
    command: config.command || "",
    args: config.args ?? [],
    ...(config.cwd ? { cwd: config.cwd } : {}),
    ...(config.env !== undefined ? { env: config.env } : {}),
  } : {
    url: config.url || "",
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
  };
  return JSON.stringify({ name, ...(description ? { description } : {}), transport: config.transport, ...connection }, null, 2);
}

export function validateMcpConnection(config: Record<string, unknown>): void {
  if (config.transport === "http") {
    try {
      const url = new URL(String(config.url || "").trim());
      if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) {
        invalidField("url");
      }
    } catch { invalidField("url"); }
  } else {
    const command = String(config.command || "");
    if (!(command.startsWith("/") || /^[A-Za-z]:[\\/]/.test(command) || /^\\\\[^\\]+\\[^\\]+/.test(command)) || command.includes("\0")) {
      throw new Error(tr("ai:v2.mcpAbsolutePath"));
    }
    if (config.trustedStdio !== true) throw new Error(tr("ai:v2.mcpTrustRequired"));
  }
}
