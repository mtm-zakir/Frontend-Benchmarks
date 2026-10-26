import "@shared/config/agent-style.css";
import { LitElement, html, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
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

class BenchmarkApp extends LitElement {
  static properties = {
    messages: { type: Array },
    agentState: { type: Object },
    typedPrompt: { type: String },
    results: { type: Array },
    step: { type: Number },
  };

  createRenderRoot() {
    return this; // Light DOM for Playwright querying
  }

  constructor() {
    super();
    this.messages = [];
    this.agentState = {
      status: "idle",
      modelName: CONFIG.MODEL_NAME,
      runtime: CONFIG.RUNTIME_DESC,
      tokensGenerated: 0,
      tps: 0,
      ttft: 0,
      contextTokens: 0,
    };
    this.typedPrompt = "";
    this.results = [];
    this.step = 1;
    this._resultsBuffer = [];
  }

  scrollToBottom() {
    const thread = this.querySelector(".chat-thread");
    if (thread) thread.scrollTop = thread.scrollHeight;
  }

  connectedCallback() {
    super.connectedCallback();
    setTimeout(() => {
      monitor.start(CONFIG.ACTION_TEXTS.INIT);
      const initRes = initAiRuntime();
      this.agentState = initRes.state;
      this.messages = [initRes.initialMessage];
      this.step = 2;
      this.requestUpdate();
      this.scrollToBottom();
    }, 400);
  }

  updated(changedProps) {
    if (!changedProps.has("step")) return;
    const prevStep = changedProps.get("step");
    if (prevStep === this.step) return;

    const measurement = monitor.stop();
    if (measurement) {
      this._resultsBuffer.push({
        action: measurement.name,
        duration: measurement.duration,
      });
    }

    const { step } = this;
    if (step > 1 && step <= 10) {
      setTimeout(async () => {
        if (step === 2) {
          monitor.start(CONFIG.ACTION_TEXTS.TTFT);
          const ttftRes = simulateFirstToken();
          this.messages = [...this.messages, ttftRes.userMsg, ttftRes.assistantMsg];
          this.agentState = {
            ...this.agentState,
            status: "inferencing",
            tokensGenerated: 1,
            ttft: ttftRes.ttftMs,
          };
          this.step = 3;
        } else if (step === 3) {
          monitor.start(CONFIG.ACTION_TEXTS.STREAMING);
          const fullContent = getFullStreamedContent();
          const next = [...this.messages];
          const lastIdx = next.length - 1;
          next[lastIdx] = {
            ...next[lastIdx],
            content: fullContent,
            tokens: 148,
          };
          this.messages = next;
          this.agentState = {
            ...this.agentState,
            status: "streaming",
            tokensGenerated: 148,
            tps: 52.4,
          };
          this.step = 4;
        } else if (step === 4) {
          monitor.start(CONFIG.ACTION_TEXTS.TOOL);
          const toolRes = createToolCallingTurn();
          this.messages = [...this.messages, toolRes.userMsg, toolRes.toolCallMsg];
          this.agentState = {
            ...this.agentState,
            status: "tool_executing",
            tokensGenerated: this.agentState.tokensGenerated + 70,
          };
          this.step = 5;
        } else if (step === 5) {
          monitor.start(CONFIG.ACTION_TEXTS.CONVERSATION);
          this.messages = createLargeConversation(25);
          this.agentState = {
            ...this.agentState,
            contextTokens: 2840,
            tokensGenerated: this.agentState.tokensGenerated + 1500,
          };
          this.step = 6;
        } else if (step === 6) {
          monitor.start(CONFIG.ACTION_TEXTS.STATE);
          this.agentState = runAgentStateUpdates(this.agentState);
          this.step = 7;
        } else if (step === 7) {
          monitor.start(CONFIG.ACTION_TEXTS.STORAGE);
          try { await Promise.race([performStorageIO(), new Promise((r) => setTimeout(r, 5000))]); } catch {}
          this.step = 8;
        } else if (step === 8) {
          monitor.start(CONFIG.ACTION_TEXTS.CONCURRENT);
          const typing = simulateConcurrentInteraction();
          this.typedPrompt = typing.typedText;
          this.step = 9;
        } else if (step === 9) {
          monitor.start(CONFIG.ACTION_TEXTS.CANCEL);
          const cancelRes = simulateCancellation([]);
          this.messages = [...this.messages, cancelRes.updatedMessages];
          this.agentState = cancelRes.cancelledState;
          this.step = 10;
        } else if (step === 10) {
          monitor.start(CONFIG.ACTION_TEXTS.CLEAR);
          const clearRes = clearSession();
          this.messages = clearRes.messages;
          this.agentState = clearRes.state;
          this.typedPrompt = "";
          this.step = 11;
        }
        this.scrollToBottom();
      }, 250);
    } else if (step === 11) {
      this.results = [...this._resultsBuffer];
    }
  }

  render() {
    const isRunning = this.step > 0 && this.step <= 10;
    const totalTime = this.results.reduce((acc, curr) => acc + curr.duration, 0);

    return html`
      <div class="agent-app">
        <div class="agent-header">
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
          <div class="badge-row">
            <span class="chip chip-fw">Lit</span>
            <span class="chip">${CONFIG.MODEL_NAME}</span>
            <span class="chip ${isRunning ? "chip-running" : "chip-status"}">
              ${isRunning ? `Running Benchmark... (${this.step}/10)` : "Ready / Idle"}
            </span>
            <span class="chip">Tokens: ${this.agentState.tokensGenerated}</span>
          </div>
        </div>

        ${this.step === 11
          ? html`
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
                    ${this.results.map(
                      (res) => html`
                        <tr>
                          <td>${res.action}</td>
                          <td><strong>${res.duration.toFixed(2)}</strong></td>
                        </tr>
                      `
                    )}
                    <tr class="total-row">
                      <td><strong>Total Time</strong></td>
                      <td><strong>${totalTime.toFixed(2)}</strong></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            `
          : nothing}

        <div class="chat-workspace">
          <div class="chat-thread">
            ${this.messages.length === 0
              ? html`<p style="color:var(--text-muted);text-align:center;padding:40px">
                  ${CONFIG.UI_TEXT.EMPTY_CHAT}
                </p>`
              : this.messages.map((m) => {
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

                  return html`
                    <div class="chat-bubble ${roleClass}">
                      <div class="bubble-header">
                        <span>${roleName}</span>
                        <span>${m.timestamp || ""}</span>
                      </div>

                      ${m.thinking
                        ? html`
                            <div class="agent-thinking">
                              <div class="thinking-label">Reasoning Process</div>
                              ${m.thinking}
                            </div>
                          `
                        : nothing}
                      ${m.toolCall
                        ? html`
                            <div class="tool-call">
                              <span class="tool-badge">Tool: ${m.toolCall.name}</span>
                              <div><code>Args: ${m.toolCall.args}</code></div>
                              ${m.toolCall.result
                                ? html`<div class="tool-result">Result: ${m.toolCall.result}</div>`
                                : nothing}
                            </div>
                          `
                        : nothing}

                      <div class="bubble-content">
                        ${unsafeHTML(formatMarkdown(m.content))}
                      </div>
                    </div>
                  `;
                })}
          </div>

          <div class="chat-input-bar">
            <input
              type="text"
              class="agent-input"
              placeholder="Type your message or prompt to local OSS-Agent..."
              .value="${this.typedPrompt}"
              readonly
            />
            <button class="agent-btn" disabled>
              ${isRunning ? "Benchmarking..." : "Benchmark Complete"}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define("benchmark-app", BenchmarkApp);

if (!document.querySelector("benchmark-app")) {
  document.getElementById("root")?.appendChild(document.createElement("benchmark-app"));
}
