import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import process from "node:process";
import { setTimeout, clearTimeout } from "node:timers";
const execute = promisify(execFile);
export async function checkInstalledClients(connection, output) {
  const report = { modelTurns: "not-run", globalConfigs: "untouched" };
  const claude = join(process.env.USERPROFILE, ".local/bin/claude.exe");
  const codex = join(
    process.env.APPDATA,
    "npm/node_modules/@openai/codex/bin/codex.js",
  );
  const env = { ...process.env, MINEMOD_STUDIO_TOKEN: connection.token };
  const cwd = join(output, "client-checks");
  await mkdir(cwd, { recursive: true });
  await access(claude);
  const claudeHome = join(cwd, "claude-config");
  await mkdir(claudeHome, { recursive: true });
  const claudeEnv = {
    ...env,
    CLAUDE_CONFIG_DIR: claudeHome,
    ENABLE_CLAUDEAI_MCP_SERVERS: "false",
  };
  await execute(
    claude,
    [
      "mcp",
      "add",
      "--scope",
      "user",
      "--transport",
      "http",
      "minemod-studio",
      connection.url,
      "--header",
      "Authorization: Bearer ${MINEMOD_STUDIO_TOKEN}",
    ],
    { env: claudeEnv, cwd, timeout: 20_000, windowsHide: true },
  );
  const healthy = await execute(claude, ["mcp", "list"], {
    env: claudeEnv,
    cwd,
    timeout: 30_000,
    windowsHide: true,
  });
  assert.match(healthy.stdout, /minemod-studio.*Connected/iu);
  report.claude = {
    status: "PASS",
    version: (
      await execute(claude, ["--version"], { windowsHide: true })
    ).stdout.trim(),
    checks: [
      "isolated config registration",
      "bearer environment expansion",
      "actual HTTP health check",
    ],
    toolCalls: "not-run",
  };

  await access(codex);
  const codexHome = join(cwd, "codex-config");
  await mkdir(codexHome, { recursive: true });
  await writeFile(
    join(codexHome, "config.toml"),
    `[mcp_servers.minemod-studio]\nurl = "${connection.url}"\nbearer_token_env_var = "MINEMOD_STUDIO_TOKEN"\nstartup_timeout_sec = 15\ntool_timeout_sec = 20\ndefault_tools_approval_mode = "approve"\n`,
  );
  // Изоляция только дочернего процесса; авторизация и настройки пользователя не читаются и не меняются.
  const child = spawn(process.execPath, [codex, "app-server", "--stdio"], {
    env: { ...env, CODEX_HOME: codexHome },
    cwd,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let sequence = 0,
    buffered = "";
  const waiting = new Map();
  const rpc = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error(`Codex protocol timeout: ${method}`));
      }, 25_000);
      waiting.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffered += chunk;
    let end;
    while ((end = buffered.indexOf("\n")) >= 0) {
      const line = buffered.slice(0, end);
      buffered = buffered.slice(end + 1);
      let value;
      try {
        value = JSON.parse(line);
      } catch {
        continue;
      }
      const target = waiting.get(value.id);
      if (target) {
        clearTimeout(target.timer);
        waiting.delete(value.id);
        if (value.error) target.reject(new Error(value.error.message));
        else target.resolve(value.result);
      } else if (value.id !== undefined && value.method)
        child.stdin.write(
          JSON.stringify({
            id: value.id,
            error: {
              code: -32601,
              message:
                "Interactive requests disabled in isolated client verification",
            },
          }) + "\n",
        );
    }
  });
  child.stderr.on("data", () => {
    /* Не сохраняем секреты или произвольные сообщения клиента. */
  });
  child.on("error", (error) => {
    for (const target of waiting.values()) {
      clearTimeout(target.timer);
      target.reject(error);
    }
    waiting.clear();
  });
  try {
    await rpc("initialize", {
      clientInfo: { name: "minemod_client_verification", version: "1" },
      capabilities: { experimentalApi: true },
    });
    child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
    const inventory = await rpc("mcpServerStatus/list", {
      detail: "toolsAndAuthOnly",
    });
    const registered = inventory.data.find(
      (item) => item.name === "minemod-studio",
    );
    assert.equal(Object.keys(registered.tools).length, 10);
    const started = await rpc("thread/start", {
      cwd,
      ephemeral: true,
      approvalPolicy: "never",
      sandbox: "read-only",
      baseInstructions:
        "Local MCP transport verification only. Do not start model turns.",
    });
    const threadId = started.thread.id;
    const call = async (tool, args = {}) => {
      const result = await rpc("mcpServer/tool/call", {
        threadId,
        server: "minemod-studio",
        tool,
        arguments: args,
      });
      assert(!result.isError, result.content[0]?.text);
      return { result, data: JSON.parse(result.content[0].text) };
    };
    const before = (
      await call("studio_project_inspect", { includeTexture: true })
    ).data;
    const selected = (await call("studio_selection_get")).data;
    assert(selected.cubeIds.length);
    const preview = (
      await call("studio_changes_preview", {
        projectId: before.project.projectId,
        expectedRevision: before.revision,
        key: randomUUID(),
        commands: [
          { type: "recolor", cubeIds: selected.cubeIds, color: "#839fd0" },
        ],
      })
    ).data;
    const applied = (
      await call("studio_changes_apply", {
        projectId: before.project.projectId,
        proposalId: preview.proposalId,
      })
    ).data;
    const captured = await call("studio_view_capture", {
      projectId: before.project.projectId,
      expectedRevision: applied.revision,
      view: "front",
    });
    await writeFile(
      join(output, "codex-client-front.png"),
      Buffer.from(
        captured.result.content.find((item) => item.type === "image").data,
        "base64",
      ),
    );
    const reviewed = await call("studio_model_review", {
      projectId: before.project.projectId,
      expectedRevision: applied.revision,
    });
    assert.deepEqual(reviewed.data.views, [
      "front",
      "side",
      "back",
      "perspective",
    ]);
    await writeFile(
      join(output, "codex-client-review.png"),
      Buffer.from(
        reviewed.result.content.find((item) => item.type === "image").data,
        "base64",
      ),
    );
    await call("studio_history_undo", {
      projectId: before.project.projectId,
      expectedRevision: applied.revision,
      key: randomUUID(),
    });
    assert.deepEqual(
      (await call("studio_project_inspect", { includeTexture: true })).data
        .project,
      before.project,
    );
    report.codex = {
      status: "PASS",
      version: (
        await execute(process.execPath, [codex, "--version"], {
          windowsHide: true,
        })
      ).stdout.trim(),
      checks: [
        "actual app-server MCP inventory",
        "inspect",
        "selection",
        "preview",
        "apply",
        "capture",
        "multi-view review",
        "undo",
      ],
      modelTurns: "not-run",
      ephemeralProtocolSession: true,
    };
  } finally {
    child.stdin.end();
    const ended = new Promise((resolve) => child.once("exit", resolve));
    const timer = setTimeout(() => child.kill(), 3000);
    await ended;
    clearTimeout(timer);
    for (const target of waiting.values()) {
      clearTimeout(target.timer);
      target.reject(new Error("Codex test stopped"));
    }
    waiting.clear();
  }
  return report;
}
