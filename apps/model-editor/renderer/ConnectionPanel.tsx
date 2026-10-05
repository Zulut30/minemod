import { useState } from "react";
import { useStudio } from "./store.ts";
import { RepairPanel } from "./RepairPanel.tsx";
export function ConnectionPanel() {
  const { connection, request, busy } = useStudio();
  const [provider, setProvider] = useState<"codex" | "claude">("codex");
  const config = connection.enabled
    ? provider === "codex"
      ? `$env:MINEMOD_STUDIO_TOKEN='${connection.token}'\ncodex mcp add minemod-studio --url ${connection.url} --bearer-token-env-var MINEMOD_STUDIO_TOKEN\ncodex`
      : `$env:MINEMOD_STUDIO_TOKEN='${connection.token}'\nclaude mcp add --transport http minemod-studio ${connection.url} --header 'Authorization: Bearer \${MINEMOD_STUDIO_TOKEN}'\nclaude`
    : "";
  return (
    <div className="agent-card" data-testid="agent-panel">
      <strong>Codex / Claude Code</strong>
      <p>
        {connection.enabled
          ? "Доступ к общей сцене включён. Агент может читать и менять незакреплённые части."
          : "Подключите агента к проекту: форма, цвет, история и снимки с разных сторон."}
      </p>
      <button
        data-testid="agent-toggle"
        disabled={busy}
        onClick={() => {
          void request({
            kind: "connection",
            action: connection.enabled ? "stop" : "start",
          });
        }}
      >
        {connection.enabled ? "Выключить доступ" : "Включить подключение"}
      </button>
      <RepairPanel />
      {connection.enabled && (
        <>
          <small data-testid="agent-endpoint">{connection.url}</small>
          <details>
            <summary>Настройка подключения</summary>
            <select
              aria-label="AI-клиент"
              value={provider}
              onChange={(e) =>
                setProvider(e.target.value as "codex" | "claude")
              }
            >
              <option value="codex">Codex CLI</option>
              <option value="claude">Claude Code</option>
            </select>
            <p>
              Выполните в PowerShell. Команда добавляет сервер в выбранный
              клиент; его вход в аккаунт должен быть уже настроен.
            </p>
            <textarea
              aria-label="Команды подключения"
              readOnly
              value={config}
              rows={7}
              onFocus={(e) => e.target.select()}
            />
            <p>
              Ключ действует до выключения доступа или закрытия Studio. После
              перезапуска повторите настройку. Не публикуйте ключ.
            </p>
          </details>
          <span className="tiny-tag">MCP ДОСТУПЕН · ЛОКАЛЬНО</span>
        </>
      )}
    </div>
  );
}
