import "@shared/config/agent-style.css";
import { render, Component } from "inferno";
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

class App extends Component {
  constructor(props) {
    super(props);
    this.state = {
      messages: [],
      agentState: {
        status: "idle",
        modelName: CONFIG.MODEL_NAME,
        runtime: CONFIG.RUNTIME_DESC,
        tokensGenerated: 0,
        tps: 0,
        ttft: 0,
        contextTokens: 0,
      },
      typedPrompt: "",
      results: [],
      step: 1,
    };
    this.resultsBuffer = [];
    this.chatThreadRef = null;
  }

  scrollToBottom() {
    if (this.chatThreadRef) {
      this.chatThreadRef.scrollTop = this.chatThreadRef.scrollHeight;
    }
  }

  componentDidMount() {
    setTimeout(() => {
      monitor.start(CONFIG.ACTION_TEXTS.INIT);
      const initRes = initAiRuntime();
      this.setState({
        messages: [initRes.initialMessage],
        agentState: initRes.state,
        step: 2,
      });
      this.scrollToBottom();
    }, 400);
  }

  componentDidUpdate(prevProps, prevState) {
    const { step } = this.state;
    if (prevState.step === step) return;

    const measurement = monitor.stop();
    if (measurement) {
      this.resultsBuffer.push({
        action: measurement.name,
        duration: measurement.duration,
      });
    }

    if (step > 1 && step <= 10) {
      setTimeout(async () => {
        if (step === 2) {
          monitor.start(CONFIG.ACTION_TEXTS.TTFT);
          const ttftRes = simulateFirstToken();
          this.setState((s) => ({
            messages: [...s.messages, ttftRes.userMsg, ttftRes.assistantMsg],
            agentState: {
              ...s.agentState,
              status: "inferencing",
              tokensGenerated: 1,
              ttft: ttftRes.ttftMs,
            },
            step: 3,
          }));
        } else if (step === 3) {
          monitor.start(CONFIG.ACTION_TEXTS.STREAMING);
          const fullContent = getFullStreamedContent();
          this.setState((s) => {
            const next = [...s.messages];
            const lastIdx = next.length - 1;
            next[lastIdx] = {
              ...next[lastIdx],
              content: fullContent,
              tokens: 148,
            };
            return {
              messages: next,
              agentState: {
                ...s.agentState,
                status: "streaming",
                tokensGenerated: 148,
                tps: 52.4,
              },
              step: 4,
            };
          });
        } else if (step === 4) {
          monitor.start(CONFIG.ACTION_TEXTS.TOOL);
          const toolRes = createToolCallingTurn();
          this.setState((s) => ({
            messages: [...s.messages, toolRes.userMsg, toolRes.toolCallMsg],
            agentState: {
              ...s.agentState,
              status: "tool_executing",
              tokensGenerated: s.agentState.tokensGenerated + 70,
            },
            step: 5,
          }));
        } else if (step === 5) {
          monitor.start(CONFIG.ACTION_TEXTS.CONVERSATION);
          this.setState((s) => ({
            messages: createLargeConversation(25),
            agentState: {
              ...s.agentState,
              contextTokens: 2840,
              tokensGenerated: s.agentState.tokensGenerated + 1500,
            },
            step: 6,
          }));
        } else if (step === 6) {
          monitor.start(CONFIG.ACTION_TEXTS.STATE);
          this.setState((s) => ({
            agentState: runAgentStateUpdates(s.agentState),
            step: 7,
          }));
        } else if (step === 7) {
          monitor.start(CONFIG.ACTION_TEXTS.STORAGE);
          try {
            await Promise.race([
              performStorageIO(),
              new Promise((resolve) => setTimeout(resolve, 5000)),
            ]);
          } catch {}
          this.setState({ step: 8 });
        } else if (step === 8) {
          monitor.start(CONFIG.ACTION_TEXTS.CONCURRENT);
          const typing = simulateConcurrentInteraction();
          this.setState({ typedPrompt: typing.typedText, step: 9 });
        } else if (step === 9) {
          monitor.start(CONFIG.ACTION_TEXTS.CANCEL);
          const cancelRes = simulateCancellation([]);
          this.setState((s) => ({
            messages: [...s.messages, cancelRes.updatedMessages],
            agentState: cancelRes.cancelledState,
            step: 10,
          }));
        } else if (step === 10) {
          monitor.start(CONFIG.ACTION_TEXTS.CLEAR);
          const clearRes = clearSession();
          this.setState({
            messages: clearRes.messages,
            agentState: clearRes.state,
            typedPrompt: "",
            step: 11,
          });
        }
        this.scrollToBottom();
      }, 250);
    } else if (step === 11) {
      this.setState({ results: [...this.resultsBuffer] });
    }
  }

  render() {
    const { messages, agentState, typedPrompt, results, step } = this.state;
    const isRunning = step > 0 && step <= 10;
    const totalTime = results.reduce((acc, curr) => acc + curr.duration, 0);

    return (
      <div className="agent-app">
        <div className="agent-header">
          <div className="header-title-wrap">
            <h1>{CONFIG.UI_TEXT.TITLE}</h1>
            <p>{CONFIG.UI_TEXT.SUBTITLE}</p>
          </div>
          <div className="specs-bar">
            <span className="spec-chip">OS: <strong>{SYSTEM_SPECS.os}</strong></span>
            <span className="spec-chip">CPU: <strong>{SYSTEM_SPECS.cpu}</strong></span>
            <span className="spec-chip">NPU: <strong>{SYSTEM_SPECS.npu}</strong></span>
            <span className="spec-chip">Cores: <strong>{SYSTEM_SPECS.cores}</strong></span>
            <span className="spec-chip">RAM: <strong>{SYSTEM_SPECS.ram}</strong></span>
            <span className="spec-chip">Engine: <strong>{SYSTEM_SPECS.engine}</strong></span>
          </div>
          <div className="badge-row">
            <span className="chip chip-fw">Inferno</span>
            <span className="chip">{CONFIG.MODEL_NAME}</span>
            <span className={`chip ${isRunning ? "chip-running" : "chip-status"}`}>
              {isRunning ? `Running Benchmark... (${step}/10)` : "Ready / Idle"}
            </span>
            <span className="chip">Tokens: {agentState.tokensGenerated}</span>
          </div>
        </div>

        {step === 11 && (
          <div className="results-container">
            <h2>Benchmark Results</h2>
            <table className="benchmark-table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Duration (ms)</th>
                </tr>
              </thead>
              <tbody>
                {results.map((res, idx) => (
                  <tr key={idx}>
                    <td>{res.action}</td>
                    <td>
                      <strong>{res.duration.toFixed(2)}</strong>
                    </td>
                  </tr>
                ))}
                <tr className="total-row">
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

        <div className="chat-workspace">
          <div className="chat-thread" ref={(el) => (this.chatThreadRef = el)}>
            {messages.length === 0 ? (
              <p style={{ color: "var(--text-muted)", textAlign: "center", padding: "40px" }}>
                {CONFIG.UI_TEXT.EMPTY_CHAT}
              </p>
            ) : (
              messages.map((m) => {
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
                  <div key={m.id} className={`chat-bubble ${roleClass}`}>
                    <div className="bubble-header">
                      <span>{roleName}</span>
                      <span>{m.timestamp || ""}</span>
                    </div>

                    {m.thinking && (
                      <div className="agent-thinking">
                        <div className="thinking-label">Reasoning Process</div>
                        {m.thinking}
                      </div>
                    )}

                    {m.toolCall && (
                      <div className="tool-call">
                        <span className="tool-badge">Tool: {m.toolCall.name}</span>
                        <div>
                          <code>Args: {m.toolCall.args}</code>
                        </div>
                        {m.toolCall.result && (
                          <div className="tool-result">Result: {m.toolCall.result}</div>
                        )}
                      </div>
                    )}

                    <div
                      className="bubble-content"
                      dangerouslySetInnerHTML={{ __html: formatMarkdown(m.content) }}
                    />
                  </div>
                );
              })
            )}
          </div>

          <div className="chat-input-bar">
            <input
              type="text"
              className="agent-input"
              placeholder="Type your message or prompt to local OSS-Agent..."
              value={typedPrompt}
              readOnly
            />
            <button className="agent-btn" disabled>
              {isRunning ? "Benchmarking..." : "Benchmark Complete"}
            </button>
          </div>
        </div>
      </div>
    );
  }
}

render(<App />, document.getElementById("root"));
