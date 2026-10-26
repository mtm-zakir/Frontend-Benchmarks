import "@shared/config/agent-style.css";
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
import { createSignal, createEffect, onMount, For, Show } from "solid-js";

type BenchmarkResult = { action: string; duration: number };

function App() {
  const [messages, setMessages] = createSignal<Message[]>([]);
  const [agentState, setAgentState] = createSignal<AgentState>({
    status: "idle",
    modelName: CONFIG.MODEL_NAME,
    runtime: CONFIG.RUNTIME_DESC,
    tokensGenerated: 0,
    tps: 0,
    ttft: 0,
    contextTokens: 0,
  });
  const [typedPrompt, setTypedPrompt] = createSignal("");
  const [results, setResults] = createSignal<BenchmarkResult[]>([]);
  const [step, setStep] = createSignal(1);

  const resultsBuffer: BenchmarkResult[] = [];
  let chatThreadEl: HTMLDivElement | undefined;

  const scrollToBottom = () => {
    if (chatThreadEl) {
      chatThreadEl.scrollTop = chatThreadEl.scrollHeight;
    }
  };

  onMount(() => {
    setTimeout(() => {
      monitor.start(CONFIG.ACTION_TEXTS.INIT);
      const initRes = initAiRuntime();
      setAgentState(initRes.state);
      setMessages([initRes.initialMessage]);
      setStep(2);
      scrollToBottom();
    }, 400);
  });

  createEffect(() => {
    const currentStep = step();
    if (currentStep <= 1) return;

    const measurement = monitor.stop();
    if (measurement) {
      resultsBuffer.push({
        action: measurement.name,
        duration: measurement.duration,
      });
    }

    if (currentStep > 1 && currentStep <= 10) {
      const timer = setTimeout(async () => {
        if (currentStep === 2) {
          monitor.start(CONFIG.ACTION_TEXTS.TTFT);
          const ttftRes = simulateFirstToken();
          setMessages((prev) => [...prev, ttftRes.userMsg, ttftRes.assistantMsg]);
          setAgentState((prev) => ({
            ...prev,
            status: "inferencing",
            tokensGenerated: 1,
            ttft: ttftRes.ttftMs,
          }));
          setStep(3);
        } else if (currentStep === 3) {
          monitor.start(CONFIG.ACTION_TEXTS.STREAMING);
          const fullContent = getFullStreamedContent();
          setMessages((prev) => {
            const next = [...prev];
            const lastIdx = next.length - 1;
            next[lastIdx] = {
              ...next[lastIdx],
              content: fullContent,
              tokens: 148,
            };
            return next;
          });
          setAgentState((prev) => ({
            ...prev,
            status: "streaming",
            tokensGenerated: 148,
            tps: 52.4,
          }));
          setStep(4);
        } else if (currentStep === 4) {
          monitor.start(CONFIG.ACTION_TEXTS.TOOL);
          const toolRes = createToolCallingTurn();
          setMessages((prev) => [...prev, toolRes.userMsg, toolRes.toolCallMsg]);
          setAgentState((prev) => ({
            ...prev,
            status: "tool_executing",
            tokensGenerated: prev.tokensGenerated + 70,
          }));
          setStep(5);
        } else if (currentStep === 5) {
          monitor.start(CONFIG.ACTION_TEXTS.CONVERSATION);
          setMessages(createLargeConversation(25));
          setAgentState((prev) => ({
            ...prev,
            contextTokens: 2840,
            tokensGenerated: prev.tokensGenerated + 1500,
          }));
          setStep(6);
        } else if (currentStep === 6) {
          monitor.start(CONFIG.ACTION_TEXTS.STATE);
          setAgentState((prev) => runAgentStateUpdates(prev));
          setStep(7);
        } else if (currentStep === 7) {
          monitor.start(CONFIG.ACTION_TEXTS.STORAGE);
          try { await Promise.race([performStorageIO(), new Promise((r) => setTimeout(r, 5000))]); } catch {}
          setStep(8);
        } else if (currentStep === 8) {
          monitor.start(CONFIG.ACTION_TEXTS.CONCURRENT);
          const typing = simulateConcurrentInteraction();
          setTypedPrompt(typing.typedText);
          setStep(9);
        } else if (currentStep === 9) {
          monitor.start(CONFIG.ACTION_TEXTS.CANCEL);
          const cancelRes = simulateCancellation([]);
          setMessages((prev) => [...prev, cancelRes.updatedMessages]);
          setAgentState(cancelRes.cancelledState);
          setStep(10);
        } else if (currentStep === 10) {
          monitor.start(CONFIG.ACTION_TEXTS.CLEAR);
          const clearRes = clearSession();
          setMessages(clearRes.messages);
          setAgentState(clearRes.state);
          setTypedPrompt("");
          setStep(11);
        }
        scrollToBottom();
      }, 250);
      return () => clearTimeout(timer);
    } else if (currentStep === 11) {
      setResults([...resultsBuffer]);
    }
  });

  const isRunning = () => step() > 0 && step() <= 10;
  const totalTime = () => results().reduce((acc, curr) => acc + curr.duration, 0);

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
          <span class="chip chip-fw">SolidJS</span>
          <span class="chip">{CONFIG.MODEL_NAME}</span>
          <span class={`chip ${isRunning() ? "chip-running" : "chip-status"}`}>
            {isRunning() ? `Running Benchmark... (${step()}/10)` : "Ready / Idle"}
          </span>
          <span class="chip">Tokens: {agentState().tokensGenerated}</span>
        </div>
      </div>

      <Show when={step() === 11}>
        <div class="results-container">
          <h2>Benchmark Results</h2>
          <table class="benchmark-table">
            <thead>
              <tr>
                <th>Action</th>
                <th>Duration (ms)</th>
              </tr>
            </thead>
            <tbody>
              <For each={results()}>
                {(res) => (
                  <tr>
                    <td>{res.action}</td>
                    <td>
                      <strong>{res.duration.toFixed(2)}</strong>
                    </td>
                  </tr>
                )}
              </For>
              <tr class="total-row">
                <td>
                  <strong>Total Time</strong>
                </td>
                <td>
                  <strong>{totalTime().toFixed(2)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Show>

      <div class="chat-workspace">
        <div class="chat-thread" ref={chatThreadEl}>
          <Show
            when={messages().length > 0}
            fallback={
              <p style={{ color: "var(--text-muted)", "text-align": "center", padding: "40px" }}>
                {CONFIG.UI_TEXT.EMPTY_CHAT}
              </p>
            }
          >
            <For each={messages()}>
              {(m) => {
                const roleClass =
                  m.role === "user"
                    ? "bubble-user"
                    : m.role === "system"
                    ? "bubble-system"
                    : "bubble-assistant";
                const roleName =
                  m.role === "user"
                    ? "User"
                    : m.role === "system"
                    ? "System Core"
                    : "AI Assistant";

                return (
                  <div class={`chat-bubble ${roleClass}`}>
                    <div class="bubble-header">
                      <span>{roleName}</span>
                      <span>{m.timestamp || ""}</span>
                    </div>

                    <Show when={m.thinking}>
                      <div class="agent-thinking">
                        <div class="thinking-label">Reasoning Process</div>
                        {m.thinking}
                      </div>
                    </Show>

                    <Show when={m.toolCall}>
                      <div class="tool-call">
                        <span class="tool-badge">Tool: {m.toolCall?.name}</span>
                        <div>
                          <code>Args: {m.toolCall?.args}</code>
                        </div>
                        <Show when={m.toolCall?.result}>
                          <div class="tool-result">Result: {m.toolCall?.result}</div>
                        </Show>
                      </div>
                    </Show>

                    <div class="bubble-content" innerHTML={formatMarkdown(m.content)} />
                  </div>
                );
              }}
            </For>
          </Show>
        </div>

        <div class="chat-input-bar">
          <input
            type="text"
            class="agent-input"
            placeholder="Type your message or prompt to local OSS-Agent..."
            value={typedPrompt()}
            readOnly
          />
          <button class="agent-btn" disabled>
            {isRunning() ? "Benchmarking..." : "Benchmark Complete"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
