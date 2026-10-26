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
} from "@shared/config";

let messages = [];
let agentState = {
  status: "idle",
  modelName: CONFIG.MODEL_NAME,
  runtime: CONFIG.RUNTIME_DESC,
  tokensGenerated: 0,
  tps: 0,
  ttft: 0,
  contextTokens: 0,
};
let results = [];
let step = 1;
let typedPrompt = "";

const root = document.getElementById("root");

function render() {
  const isRunning = step > 0 && step <= 10;

  let resultsHtml = "";
  if (step === 11) {
    const total = results.reduce((acc, r) => acc + r.duration, 0);
    const rows = results
      .map(
        (r) =>
          `<tr><td>${r.action}</td><td><strong>${r.duration.toFixed(2)}</strong></td></tr>`
      )
      .join("");
    resultsHtml = `
      <div class="results-container">
        <h2>Benchmark Results</h2>
        <table border="1" class="benchmark-table">
          <thead>
            <tr><th>Action</th><th>Duration (ms)</th></tr>
          </thead>
          <tbody>
            ${rows}
            <tr class="total-row">
              <td><strong>Total Time</strong></td>
              <td><strong>${total.toFixed(2)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>`;
  }

  const messagesHtml =
    messages.length === 0
      ? `<p style="color:var(--text-muted);text-align:center;padding:40px">${CONFIG.UI_TEXT.EMPTY_CHAT}</p>`
      : messages
          .map((m) => {
            let roleClass = "bubble-assistant";
            let roleName = "AI Assistant";
            if (m.role === "user") {
              roleClass = "bubble-user";
              roleName = "User";
            } else if (m.role === "system") {
              roleClass = "bubble-system";
              roleName = "System Core";
            }

            const thinkingHtml = m.thinking
              ? `<div class="agent-thinking"><div class="thinking-label">Reasoning Process</div>${m.thinking}</div>`
              : "";

            let toolHtml = "";
            if (m.toolCall) {
              toolHtml = `
                <div class="tool-call">
                  <span class="tool-badge">Tool: ${m.toolCall.name}</span>
                  <div><code>Args: ${m.toolCall.args}</code></div>
                  ${m.toolCall.result ? `<div class="tool-result">Result: ${m.toolCall.result}</div>` : ""}
                </div>`;
            }

            return `
              <div class="chat-bubble ${roleClass}">
                <div class="bubble-header">
                  <span>${roleName}</span>
                  <span>${m.timestamp || ""}</span>
                </div>
                ${thinkingHtml}
                ${toolHtml}
                <div class="bubble-content">${formatMarkdown(m.content)}</div>
              </div>`;
          })
          .join("");

  root.innerHTML = `
    <div class="agent-app">
      <div class="agent-header">
        <div>
          <div class="header-title-wrap">
            <h1>${CONFIG.UI_TEXT.TITLE}</h1>
            <p>${CONFIG.UI_TEXT.SUBTITLE}</p>
          </div>
          <div class="specs-bar">
            <span class="spec-chip">OS: <strong>${SYSTEM_SPECS.os}</strong></span>
            <span class="spec-chip">CPU: <strong>${SYSTEM_SPECS.cpu}</strong></span>
            <span class="spec-chip">NPU: <strong>${SYSTEM_SPECS.npu}</strong></span>
            <span class="spec-chip">Cores: <strong>${SYSTEM_SPECS.cores}</strong></span>
            <span class="spec-chip">RAM: <strong>${SYSTEM_SPECS.ram}</strong></span>
            <span class="spec-chip">Engine: <strong>${SYSTEM_SPECS.engine}</strong></span>
          </div>
        </div>
        <div class="badge-row">
          <span class="chip chip-fw">Vanilla JS</span>
          <span class="chip">${CONFIG.MODEL_NAME}</span>
          <span class="chip ${isRunning ? "chip-running" : "chip-status"}">
            ${isRunning ? `Running Benchmark... (${step}/10)` : "Ready / Idle"}
          </span>
          <span class="chip">Tokens: ${agentState.tokensGenerated}</span>
        </div>
      </div>

      ${resultsHtml}

      <div class="chat-workspace">
        <div class="chat-thread" id="chatThread">
          ${messagesHtml}
        </div>
        <div class="chat-input-bar">
          <input
            type="text"
            class="agent-input"
            placeholder="Type your message or prompt to local OSS-Agent..."
            value="${typedPrompt}"
            readonly
          />
          <button class="agent-btn" id="runBtn" disabled>
            ${isRunning ? "Benchmarking..." : "Benchmark Complete"}
          </button>
        </div>
      </div>
    </div>`;

  const chatEl = document.getElementById("chatThread");
  if (chatEl) {
    chatEl.scrollTop = chatEl.scrollHeight;
  }
}

function recordResult() {
  const result = monitor.stop();
  if (result) {
    results.push({ action: result.name, duration: result.duration });
  }
}

async function runBenchmark() {
  render();

  // Step 1: Model & Runtime Init
  await new Promise((r) => setTimeout(r, 350));
  monitor.start(CONFIG.ACTION_TEXTS.INIT);
  const initRes = initAiRuntime();
  agentState = initRes.state;
  messages = [initRes.initialMessage];
  step = 2;
  render();
  recordResult();

  // Step 2: First Token Latency (TTFT)
  await new Promise((r) => setTimeout(r, 250));
  monitor.start(CONFIG.ACTION_TEXTS.TTFT);
  const ttftRes = simulateFirstToken();
  messages = [...messages, ttftRes.userMsg, ttftRes.assistantMsg];
  agentState = {
    ...agentState,
    status: "inferencing",
    tokensGenerated: 1,
    ttft: ttftRes.ttftMs,
  };
  step = 3;
  render();
  recordResult();

  // Step 3: Token Streaming & Render (TPS)
  await new Promise((r) => setTimeout(r, 250));
  monitor.start(CONFIG.ACTION_TEXTS.STREAMING);
  const fullContent = getFullStreamedContent();
  const lastIdx = messages.length - 1;
  messages[lastIdx] = {
    ...messages[lastIdx],
    content: fullContent,
    tokens: 148,
  };
  agentState = {
    ...agentState,
    status: "streaming",
    tokensGenerated: 148,
    tps: 52.4,
  };
  step = 4;
  render();
  recordResult();

  // Step 4: Tool-Calling Execution
  await new Promise((r) => setTimeout(r, 250));
  monitor.start(CONFIG.ACTION_TEXTS.TOOL);
  const toolRes = createToolCallingTurn();
  messages = [...messages, toolRes.userMsg, toolRes.toolCallMsg];
  agentState = {
    ...agentState,
    status: "tool_executing",
    tokensGenerated: agentState.tokensGenerated + 70,
  };
  step = 5;
  render();
  recordResult();

  // Step 5: Render Large Conversation History
  await new Promise((r) => setTimeout(r, 250));
  monitor.start(CONFIG.ACTION_TEXTS.CONVERSATION);
  messages = createLargeConversation(25);
  agentState = {
    ...agentState,
    contextTokens: 2840,
    tokensGenerated: agentState.tokensGenerated + 1500,
  };
  step = 6;
  render();
  recordResult();

  // Step 6: Agent State Updates
  await new Promise((r) => setTimeout(r, 250));
  monitor.start(CONFIG.ACTION_TEXTS.STATE);
  agentState = runAgentStateUpdates(agentState);
  step = 7;
  render();
  recordResult();

  // Step 7: IndexedDB Storage I/O
  await new Promise((r) => setTimeout(r, 250));
  monitor.start(CONFIG.ACTION_TEXTS.STORAGE);
  try { await Promise.race([performStorageIO(), new Promise((r) => setTimeout(r, 5000))]); } catch {}
  step = 8;
  render();
  recordResult();

  // Step 8: Concurrent UI Responsiveness Under Inference
  await new Promise((r) => setTimeout(r, 250));
  monitor.start(CONFIG.ACTION_TEXTS.CONCURRENT);
  const typing = simulateConcurrentInteraction();
  typedPrompt = typing.typedText;
  step = 9;
  render();
  recordResult();

  // Step 9: Cancellation & Teardown
  await new Promise((r) => setTimeout(r, 250));
  monitor.start(CONFIG.ACTION_TEXTS.CANCEL);
  const cancelRes = simulateCancellation(messages);
  messages = [...messages, cancelRes.updatedMessages];
  agentState = cancelRes.cancelledState;
  step = 10;
  render();
  recordResult();

  // Step 10: Clear Session & Cleanup
  await new Promise((r) => setTimeout(r, 250));
  monitor.start(CONFIG.ACTION_TEXTS.CLEAR);
  const clearRes = clearSession();
  messages = clearRes.messages;
  agentState = clearRes.state;
  typedPrompt = "";
  step = 11;
  render();
  recordResult();

  render(); // Final render with full results table
}

runBenchmark();
