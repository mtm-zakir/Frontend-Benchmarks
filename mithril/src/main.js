import "@shared/config/agent-style.css";
import m from "mithril";
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
let typedPrompt = "";
let results = [];
let step = 1;
const resultsBuffer = [];

function recordResult() {
  const result = monitor.stop();
  if (result) {
    resultsBuffer.push({ action: result.name, duration: result.duration });
  }
}

function scheduleNext() {
  setTimeout(async () => {
    if (step === 2) {
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
      m.redraw();
      recordResult();
      scheduleNext();
    } else if (step === 3) {
      monitor.start(CONFIG.ACTION_TEXTS.STREAMING);
      const fullContent = getFullStreamedContent();
      const next = [...messages];
      const lastIdx = next.length - 1;
      next[lastIdx] = {
        ...next[lastIdx],
        content: fullContent,
        tokens: 148,
      };
      messages = next;
      agentState = {
        ...agentState,
        status: "streaming",
        tokensGenerated: 148,
        tps: 52.4,
      };
      step = 4;
      m.redraw();
      recordResult();
      scheduleNext();
    } else if (step === 4) {
      monitor.start(CONFIG.ACTION_TEXTS.TOOL);
      const toolRes = createToolCallingTurn();
      messages = [...messages, toolRes.userMsg, toolRes.toolCallMsg];
      agentState = {
        ...agentState,
        status: "tool_executing",
        tokensGenerated: agentState.tokensGenerated + 70,
      };
      step = 5;
      m.redraw();
      recordResult();
      scheduleNext();
    } else if (step === 5) {
      monitor.start(CONFIG.ACTION_TEXTS.CONVERSATION);
      messages = createLargeConversation(25);
      agentState = {
        ...agentState,
        contextTokens: 2840,
        tokensGenerated: agentState.tokensGenerated + 1500,
      };
      step = 6;
      m.redraw();
      recordResult();
      scheduleNext();
    } else if (step === 6) {
      monitor.start(CONFIG.ACTION_TEXTS.STATE);
      agentState = runAgentStateUpdates(agentState);
      step = 7;
      m.redraw();
      recordResult();
      scheduleNext();
    } else if (step === 7) {
      monitor.start(CONFIG.ACTION_TEXTS.STORAGE);
      try { await Promise.race([performStorageIO(), new Promise((r) => setTimeout(r, 5000))]); } catch {}
      step = 8;
      m.redraw();
      recordResult();
      scheduleNext();
    } else if (step === 8) {
      monitor.start(CONFIG.ACTION_TEXTS.CONCURRENT);
      const typing = simulateConcurrentInteraction();
      typedPrompt = typing.typedText;
      step = 9;
      m.redraw();
      recordResult();
      scheduleNext();
    } else if (step === 9) {
      monitor.start(CONFIG.ACTION_TEXTS.CANCEL);
      const cancelRes = simulateCancellation([]);
      messages = [...messages, cancelRes.updatedMessages];
      agentState = cancelRes.cancelledState;
      step = 10;
      m.redraw();
      recordResult();
      scheduleNext();
    } else if (step === 10) {
      monitor.start(CONFIG.ACTION_TEXTS.CLEAR);
      const clearRes = clearSession();
      messages = clearRes.messages;
      agentState = clearRes.state;
      typedPrompt = "";
      step = 11;
      recordResult();
      results = [...resultsBuffer];
      m.redraw();
    }
  }, 250);
}

const App = {
  oninit() {
    setTimeout(() => {
      monitor.start(CONFIG.ACTION_TEXTS.INIT);
      const initRes = initAiRuntime();
      agentState = initRes.state;
      messages = [initRes.initialMessage];
      step = 2;
      m.redraw();
      recordResult();
      scheduleNext();
    }, 400);
  },

  view() {
    const isRunning = step > 0 && step <= 10;
    const totalTime = results.reduce((acc, curr) => acc + curr.duration, 0);

    return m(".agent-app", [
      m(".agent-header", [
        m(".header-title-wrap", [
          m("h1", CONFIG.UI_TEXT.TITLE),
          m("p", CONFIG.UI_TEXT.SUBTITLE),
        ]),
        m(".specs-bar", [
          m("span.spec-chip", ["OS: ", m("strong", SYSTEM_SPECS.os)]),
          m("span.spec-chip", ["CPU: ", m("strong", SYSTEM_SPECS.cpu)]),
          m("span.spec-chip", ["NPU: ", m("strong", SYSTEM_SPECS.npu)]),
          m("span.spec-chip", ["Cores: ", m("strong", SYSTEM_SPECS.cores)]),
          m("span.spec-chip", ["RAM: ", m("strong", SYSTEM_SPECS.ram)]),
          m("span.spec-chip", ["Engine: ", m("strong", SYSTEM_SPECS.engine)]),
        ]),
        m(".badge-row", [
          m("span.chip.chip-fw", "Mithril"),
          m("span.chip", CONFIG.MODEL_NAME),
          m(
            `span.chip.${isRunning ? "chip-running" : "chip-status"}`,
            isRunning ? `Running Benchmark... (${step}/10)` : "Ready / Idle"
          ),
          m("span.chip", `Tokens: ${agentState.tokensGenerated}`),
        ]),
      ]),

      step === 11
        ? m(".results-container", [
            m("h2", "Benchmark Results"),
            m("table.benchmark-table", { border: 1 }, [
              m("thead", [
                m("tr", [
                  m("th", "Action"),
                  m("th", "Duration (ms)"),
                ]),
              ]),
              m("tbody", [
                results.map((res) =>
                  m("tr", [
                    m("td", res.action),
                    m("td", m("strong", res.duration.toFixed(2))),
                  ])
                ),
                m("tr.total-row", [
                  m("td", m("strong", "Total Time")),
                  m("td", m("strong", totalTime.toFixed(2))),
                ]),
              ]),
            ]),
          ])
        : null,

      m(".chat-workspace", [
        m(
          ".chat-thread",
          {
            onupdate(vnode) {
              vnode.dom.scrollTop = vnode.dom.scrollHeight;
            },
          },
          messages.length === 0
            ? m("p", { style: { color: "var(--text-muted)", "text-align": "center", padding: "40px" } }, CONFIG.UI_TEXT.EMPTY_CHAT)
            : messages.map((mItem) => {
                const roleClass =
                  mItem.role === "user"
                    ? "bubble-user"
                    : mItem.role === "system"
                    ? "bubble-system"
                    : "bubble-assistant";
                const roleName =
                  mItem.role === "user"
                    ? "User"
                    : mItem.role === "system"
                    ? "System Core"
                    : "AI Assistant";

                return m(`.chat-bubble.${roleClass}`, { key: mItem.id }, [
                  m(".bubble-header", [
                    m("span", roleName),
                    m("span", mItem.timestamp || ""),
                  ]),
                  mItem.thinking
                    ? m(".agent-thinking", [
                        m(".thinking-label", "Reasoning Process"),
                        mItem.thinking,
                      ])
                    : null,
                  mItem.toolCall
                    ? m(".tool-call", [
                        m("span.tool-badge", `Tool: ${mItem.toolCall.name}`),
                        m("div", m("code", `Args: ${mItem.toolCall.args}`)),
                        mItem.toolCall.result
                          ? m(".tool-result", `Result: ${mItem.toolCall.result}`)
                          : null,
                      ])
                    : null,
                  m(".bubble-content", m.trust(formatMarkdown(mItem.content))),
                ]);
              })
        ),

        m(".chat-input-bar", [
          m("input.agent-input", {
            type: "text",
            placeholder: "Type your message or prompt to local OSS-Agent...",
            value: typedPrompt,
            readonly: true,
          }),
          m("button.agent-btn", { disabled: true }, isRunning ? "Benchmarking..." : "Benchmark Complete"),
        ]),
      ]),
    ]);
  },
};

m.mount(document.getElementById("root"), App);
