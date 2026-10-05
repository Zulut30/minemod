import { useState } from "react";
import { useStudio } from "./store.ts";
import { RepairPanel } from "./RepairPanel.tsx";
import {AgentStatusPanel} from "./AgentStatusPanel.tsx";
export function ConnectionPanel() {
  const { connection, request, busy, state, agentStatus } = useStudio();
  const [provider, setProvider] = useState<"codex" | "claude">("codex");
  const [controlling, setControlling] = useState(false);
  const control = async (action: "start" | "stop" | "pause" | "resume") => {
    setControlling(true);
    try { await request({kind:"connection", action}); }
    finally { setControlling(false); }
  };
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
          ? connection.paused
            ? "Работа со сценой приостановлена. Применённые правки и ручное редактирование сохранены."
            : "Доступ к общей сцене включён. Агент может читать и менять незакреплённые части."
          : "Подключите агента к проекту: форма, цвет, история и снимки с разных сторон."}
      </p>
      <button
        data-testid="agent-toggle"
        disabled={!agentStatus.available || controlling || busy && !connection.enabled}
        onClick={() => {
          void control(connection.enabled ? "stop" : "start");
        }}
      >
        {connection.enabled ? "Выключить доступ" : "Включить подключение"}
      </button>
      {connection.enabled && <>
        <button data-testid="agent-pause" disabled={controlling}
          onClick={() => { void control(connection.paused ? "resume" : "pause"); }}>
          {connection.paused ? "Продолжить доступ" : "Приостановить доступ"}
        </button>
        <p data-testid="agent-access-state" role="status">
          {connection.paused ? "Пауза" : "Доступ активен"} · версия сцены {state?.revision}
        </p>
        <small>Пауза отменяет ожидающие правки и снимки. Продолжение не требует повторной настройки клиента. Внешний AI-клиент работает отдельно.</small>
      </>}
      <AgentStatusPanel status={agentStatus} />
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
