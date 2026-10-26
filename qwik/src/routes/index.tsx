import "@shared/config/agent-style.css";
import { component$, useSignal, useVisibleTask$ } from "@builder.io/qwik";
import {
  CONFIG,
  SYSTEM_SPECS,
  initAiRuntime,
  simulateFirstToken,
  getFullStreamedContent,
  createToolCallingTurn,
  createLargeConversation,
  runAgentStateUpdates,
  performStorageIO,
  simulateConcurrentInteraction,
  simulateCancellation,
  clearSession,
  formatMarkdown,
  monitor,
  type Message,
  type AgentState,
} from "@shared/config";

type BenchmarkResult = { action: string; duration: number };

export default component$(() => {
  const messages = useSignal<Message[]>([]);
  const agentState = useSignal<AgentState>({
    status: "idle",
    modelName: CONFIG.MODEL_NAME,
    runtime: CONFIG.RUNTIME_DESC,
    tokensGenerated: 0,
    tps: 0,
    ttft: 0,
    contextTokens: 0,
  });
  const typedPrompt = useSignal("");
  const results = useSignal<BenchmarkResult[]>([]);
  const step = useSignal(1);
  const resultsRef = useSignal<BenchmarkResult[]>([]);

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(() => {
    const timer = setTimeout(() => {
      monitor.start(CONFIG.ACTION_TEXTS.INIT);
      const initRes = initAiRuntime();
      agentState.value = initRes.state;
      messages.value = [initRes.initialMessage];
      step.value = 2;
    }, 400);
    return () => clearTimeout(timer);
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track }) => {
    track(() => step.value);

    const measurement = monitor.stop();
    if (measurement) {
      resultsRef.value = [
        ...resultsRef.value,
        {
          action: measurement.name,
          duration: measurement.duration,
        },
      ];
    }

    if (step.value > 1 && step.value <= 10) {
      const timer = setTimeout(async () => {
        if (step.value === 2) {
          monitor.start(CONFIG.ACTION_TEXTS.TTFT);
          const ttftRes = simulateFirstToken();
          messages.value = [...messages.value, ttftRes.userMsg, ttftRes.assistantMsg];
          agentState.value = {
            ...agentState.value,
            status: "inferencing",
            tokensGenerated: 1,
            ttft: ttftRes.ttftMs,
          };
          step.value = 3;
        } else if (step.value === 3) {
          monitor.start(CONFIG.ACTION_TEXTS.STREAMING);
          const fullContent = getFullStreamedContent();
          const next = [...messages.value];
          const lastIdx = next.length - 1;
          next[lastIdx] = {
            ...next[lastIdx],
            content: fullContent,
            tokens: 148,
          };
          messages.value = next;
          agentState.value = {
            ...agentState.value,
            status: "streaming",
            tokensGenerated: 148,
            tps: 52.4,
          };
          step.value = 4;
        } else if (step.value === 4) {
          monitor.start(CONFIG.ACTION_TEXTS.TOOL);
          const toolRes = createToolCallingTurn();
          messages.value = [...messages.value, toolRes.userMsg, toolRes.toolCallMsg];
          agentState.value = {
            ...agentState.value,
            status: "tool_executing",
            tokensGenerated: agentState.value.tokensGenerated + 70,
          };
          step.value = 5;
        } else if (step.value === 5) {
          monitor.start(CONFIG.ACTION_TEXTS.CONVERSATION);
          messages.value = createLargeConversation(25);
          agentState.value = {
            ...agentState.value,
            contextTokens: 2840,
            tokensGenerated: agentState.value.tokensGenerated + 1500,
          };
          step.value = 6;
        } else if (step.value === 6) {
          monitor.start(CONFIG.ACTION_TEXTS.STATE);
          agentState.value = runAgentStateUpdates(agentState.value);
          step.value = 7;
        } else if (step.value === 7) {
          monitor.start(CONFIG.ACTION_TEXTS.STORAGE);
          try {
            await Promise.race([performStorageIO(), new Promise((r) => setTimeout(r, 5000))]);
          } catch {
            // Ignore storage benchmark timeouts or errors in test environment
          }
          step.value = 8;
        } else if (step.value === 8) {
          monitor.start(CONFIG.ACTION_TEXTS.CONCURRENT);
          const typing = simulateConcurrentInteraction();
          typedPrompt.value = typing.typedText;
          step.value = 9;
        } else if (step.value === 9) {
          monitor.start(CONFIG.ACTION_TEXTS.CANCEL);
          const cancelRes = simulateCancellation([]);
          messages.value = [...messages.value, cancelRes.updatedMessages];
          agentState.value = cancelRes.cancelledState;
          step.value = 10;
        } else if (step.value === 10) {
          monitor.start(CONFIG.ACTION_TEXTS.CLEAR);
          const clearRes = clearSession();
          messages.value = clearRes.messages;
          agentState.value = clearRes.state;
          typedPrompt.value = "";
          step.value = 11;
        }
      }, 250);
      return () => clearTimeout(timer);
    } else if (step.value === 11) {
      results.value = [...resultsRef.value];
    }
  });

  const isRunning = step.value > 0 && step.value <= 10;
  const totalTime = results.value.reduce((acc, curr) => acc + curr.duration, 0);

  return (
    <div class="agent-app">
      <div class="agent-header">
        <div class="header-title-wrap">
          <h1>{CONFIG.UI_TEXT.TITLE}</h1>
          <p>{CONFIG.UI_TEXT.SUBTITLE}</p>
        </div>
        <div class="specs-bar">
          <span class="spec-chip">OS: <strong>{SYSTEM_SPECS.os}</strong></span>
          <span class="spec-chip">CPU: <strong>{SYSTEM_SPECS.cpu}</strong></span>
          <span class="spec-chip">NPU: <strong>{SYSTEM_SPECS.npu}</strong></span>
          <span class="spec-chip">Cores: <strong>{SYSTEM_SPECS.cores}</strong></span>
          <span class="spec-chip">RAM: <strong>{SYSTEM_SPECS.ram}</strong></span>
          <span class="spec-chip">Engine: <strong>{SYSTEM_SPECS.engine}</strong></span>
        </div>
        <div class="badge-row">
          <span class="chip chip-fw">Qwik</span>
          <span class="chip">{CONFIG.MODEL_NAME}</span>
          <span class={`chip ${isRunning ? "chip-running" : "chip-status"}`}>
            {isRunning ? `Running Benchmark... (${step.value}/10)` : "Ready / Idle"}
          </span>
          <span class="chip">Tokens: {agentState.value.tokensGenerated}</span>
        </div>
      </div>

      {step.value === 11 && (
        <div class="results-container">
          <h2>Benchmark Results</h2>
          <table border="1" class="benchmark-table">
            <thead>
              <tr>
                <th>Action</th>
                <th>Duration (ms)</th>
              </tr>
            </thead>
            <tbody>
              {results.value.map((res, idx) => (
                <tr key={idx}>
                  <td>{res.action}</td>
                  <td>
                    <strong>{res.duration.toFixed(2)}</strong>
                  </td>
                </tr>
              ))}
              <tr class="total-row">
                <td>
                  <strong>Total Time</strong>
                </td>
                <td>
                  <strong>{totalTime.toFixed(2)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div class="chat-workspace">
        <div class="chat-thread">
          {messages.value.length === 0 ? (
            <p style={{ color: "var(--text-muted)", textAlign: "center", padding: "40px" }}>
              {CONFIG.UI_TEXT.EMPTY_CHAT}
            </p>
          ) : (
            messages.value.map((m) => {
              let roleClass = "bubble-assistant";
              let roleName = "AI Assistant";
              if (m.role === "user") {
                roleClass = "bubble-user";
                roleName = "User";
              } else if (m.role === "system") {
                roleClass = "bubble-system";
                roleName = "System Core";
              }

              return (
                <div key={m.id} class={`chat-bubble ${roleClass}`}>
                  <div class="bubble-header">
                    <span>{roleName}</span>
                    <span>{m.timestamp || ""}</span>
                  </div>

                  {m.thinking && (
                    <div class="agent-thinking">
                      <div class="thinking-label">Reasoning Process</div>
                      {m.thinking}
                    </div>
                  )}

                  {m.toolCall && (
                    <div class="tool-call">
                      <span class="tool-badge">Tool: {m.toolCall.name}</span>
                      <div>
                        <code>Args: {m.toolCall.args}</code>
                      </div>
                      {m.toolCall.result && (
                        <div class="tool-result">Result: {m.toolCall.result}</div>
                      )}
                    </div>
                  )}

                  <div
                    class="bubble-content"
                    dangerouslySetInnerHTML={formatMarkdown(m.content)}
                  />
                </div>
              );
            })
          )}
        </div>

        <div class="chat-input-bar">
          <input
            type="text"
            class="agent-input"
            placeholder="Type your message or prompt to local OSS-Agent..."
            value={typedPrompt.value}
            readOnly
          />
          <button class="agent-btn" disabled>
            {isRunning ? "Benchmarking..." : "Benchmark Complete"}
          </button>
        </div>
      </div>
    </div>
  );
});
