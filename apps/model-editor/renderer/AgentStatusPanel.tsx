import {useEffect, useState} from "react";
import {AGENT_TOOL_LABELS, type AgentStatus, type AgentStage} from "../shared/agent-status.ts";

const stages: Record<AgentStage,string> = {
  queued:"В очереди", running:"Выполняется", succeeded:"Завершено", failed:"Не выполнено", cancelled:"Отменено",
};
const notices = {
  RATE_LIMIT:"Достигнут локальный лимит запросов. Дождитесь освобождения очереди или следующей минуты и прочитайте сцену заново.",
  SESSION_LIMIT:"Достигнут лимит локальной сессии. Завершите прежнюю MCP-сессию и подключитесь заново; сцена сохранена.",
  SESSION_EXPIRED:"MCP-сессия завершена или истекла. Подключитесь заново и прочитайте текущую сцену.",
  CLIENT_DISCONNECTED:"Клиент прервал ожидающий запрос. Подключитесь снова и проверьте текущую сцену перед повторной правкой.",
};
const duration = (ms: number) => {
  const seconds=Math.floor(Math.max(0,ms)/1000);
  return seconds<60 ? `${seconds} с` : `${Math.floor(seconds/60)} мин ${seconds%60} с`;
};
export function AgentStatusPanel({status}:{status:AgentStatus}) {
  const [now,setNow]=useState(Date.now());
  const active=status.latest?.stage === "running" || status.latest?.stage === "queued";
  useEffect(() => {
    setNow(Date.now());
    if (!active) return;
    const timer=window.setInterval(()=>setNow(Date.now()),1000);
    return ()=>window.clearInterval(timer);
  },[active,status.latest?.id]);
  const operation=status.latest;
  const elapsed=operation ? active ? Math.max(operation.elapsedMs,now-operation.enqueuedAt) : operation.elapsedMs : 0;
  return <section className="agent-progress" aria-label="Состояние агента" data-testid="agent-progress">
    <p role="status" data-testid="agent-operation" data-stage={operation?.stage ?? "idle"}>
      {!status.available ? "Сервис редактора недоступен" : status.access === "paused" ? "Доступ приостановлен"
        : status.access === "off" ? "Доступ выключен" : operation ? `${stages[operation.stage]} · ${AGENT_TOOL_LABELS[operation.tool]}`
        : "Ожидает запросов клиента"}
    </p>
    {operation && <div className="agent-progress-line">
      <span data-testid="agent-elapsed">{duration(elapsed)}</span>
      <span data-testid="agent-queue">Очередь: {status.queued} · работа: {status.running}</span>
    </div>}
    {!status.available && <p>Перезапустите Studio для загрузки восстановительной копии. Исходные файлы сохранены.</p>}
    {status.notice && <p className="agent-notice" data-testid="agent-notice">{notices[status.notice]}</p>}
    {status.access !== "off" && <>
      <p data-testid="agent-usage">Токены: неизвестно · стоимость: неизвестно</p>
      <details data-testid="agent-budget-details">
        <summary>Запросы и локальные лимиты</summary>
        <p data-testid="agent-local-budget">Осталось HTTP-запросов за минуту: {status.httpBudget.remainingRequests} / {status.httpBudget.limit}</p>
        <p data-testid="agent-sessions">Локальные MCP-сессии: {status.sessions.length}</p>
        {status.sessions.map(session=><p key={session.client} data-testid="agent-session-budget">
          Сессия {session.client}: осталось {session.remainingRequests} / {session.limit}
        </p>)}
        <small>Это ограничения Studio. Число сессий не подтверждает, что внешний клиент сейчас работает. Токены, стоимость и действия AI вне Studio здесь недоступны.</small>
        {status.recent.length>0 && <ol className="agent-recent" aria-label="Последние запросы">
          {status.recent.map(item=><li key={item.id} data-stage={item.stage}>
            {AGENT_TOOL_LABELS[item.tool]} · {stages[item.stage]} · {duration(item.elapsedMs)}
            {item.code && <code>{item.code}</code>}
          </li>)}
        </ol>}
      </details>
    </>}
  </section>;
}
