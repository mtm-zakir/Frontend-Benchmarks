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
import { useState, useEffect, useRef } from "react";

type BenchmarkResult = { action: string; duration: number };

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [agentState, setAgentState] = useState<AgentState>({
    status: "idle",
    modelName: CONFIG.MODEL_NAME,
    runtime: CONFIG.RUNTIME_DESC,
    tokensGenerated: 0,
    tps: 0,
    ttft: 0,
    contextTokens: 0,
  });
  const [typedPrompt, setTypedPrompt] = useState("");
  const [results, setResults] = useState<BenchmarkResult[]>([]);
  const [step, setStep] = useState(1);

  const resultsRef = useRef<BenchmarkResult[]>([]);
  const chatThreadRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat
  useEffect(() => {
    if (chatThreadRef.current) {
      chatThreadRef.current.scrollTop = chatThreadRef.current.scrollHeight;
    }
  }, [messages]);

  // Initial step trigger
  useEffect(() => {
    const timer = setTimeout(() => {
      monitor.start(CONFIG.ACTION_TEXTS.INIT);
      const initRes = initAiRuntime();
      setAgentState(initRes.state);
      setMessages([initRes.initialMessage]);
      setStep(2);
    }, 400);
    return () => clearTimeout(timer);
  }, []);

  // Sequential benchmark runner
  useEffect(() => {
    if (step <= 1) return;

    const measurement = monitor.stop();
    if (measurement) {
      resultsRef.current.push({
        action: measurement.name,
        duration: measurement.duration,
      });
    }

    if (step > 1 && step <= 10) {
      const timer = setTimeout(async () => {
        if (step === 2) {
          // Step 2: TTFT
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
        } else if (step === 3) {
          // Step 3: Token Streaming
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
        } else if (step === 4) {
          // Step 4: Tool Calling
          monitor.start(CONFIG.ACTION_TEXTS.TOOL);
          const toolRes = createToolCallingTurn();
          setMessages((prev) => [...prev, toolRes.userMsg, toolRes.toolCallMsg]);
          setAgentState((prev) => ({
            ...prev,
            status: "tool_executing",
            tokensGenerated: prev.tokensGenerated + 70,
          }));
          setStep(5);
        } else if (step === 5) {
          // Step 5: Large Conversation History
          monitor.start(CONFIG.ACTION_TEXTS.CONVERSATION);
          setMessages(createLargeConversation(25));
          setAgentState((prev) => ({
            ...prev,
            contextTokens: 2840,
            tokensGenerated: prev.tokensGenerated + 1500,
          }));
          setStep(6);
        } else if (step === 6) {
          // Step 6: State Updates
          monitor.start(CONFIG.ACTION_TEXTS.STATE);
          setAgentState((prev) => runAgentStateUpdates(prev));
          setStep(7);
        } else if (step === 7) {
          // Step 7: IndexedDB Storage I/O
          monitor.start(CONFIG.ACTION_TEXTS.STORAGE);
          try { await Promise.race([performStorageIO(), new Promise((r) => setTimeout(r, 5000))]); } catch {}
          setStep(8);
        } else if (step === 8) {
          // Step 8: UI Concurrency
          monitor.start(CONFIG.ACTION_TEXTS.CONCURRENT);
          const typing = simulateConcurrentInteraction();
          setTypedPrompt(typing.typedText);
          setStep(9);
        } else if (step === 9) {
          // Step 9: Cancellation
          monitor.start(CONFIG.ACTION_TEXTS.CANCEL);
          const cancelRes = simulateCancellation([]);
          setMessages((prev) => [...prev, cancelRes.updatedMessages]);
          setAgentState(cancelRes.cancelledState);
          setStep(10);
        } else if (step === 10) {
          // Step 10: Clear Session
          monitor.start(CONFIG.ACTION_TEXTS.CLEAR);
          const clearRes = clearSession();
          setMessages(clearRes.messages);
          setAgentState(clearRes.state);
          setTypedPrompt("");
          setStep(11);
        }
      }, 250);
      return () => clearTimeout(timer);
    } else if (step === 11) {
      setResults([...resultsRef.current]);
    }
  }, [step]);

  const isRunning = step > 0 && step <= 10;
  const totalTime = results.reduce((acc, curr) => acc + curr.duration, 0);

  return (
    <div className="agent-app">
      <div className="agent-header">
        <div>
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
        </div>
        <div className="badge-row">
          <span className="chip chip-fw">React 19</span>
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
        <div className="chat-thread" ref={chatThreadRef}>
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

export default App;
