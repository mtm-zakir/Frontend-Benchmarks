<script lang="ts">
  import "@shared/config/agent-style.css";
  import { onMount, onDestroy, tick } from "svelte";
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

  let messages: Message[] = $state([]);
  let agentState: AgentState = $state({
    status: "idle",
    modelName: CONFIG.MODEL_NAME,
    runtime: CONFIG.RUNTIME_DESC,
    tokensGenerated: 0,
    tps: 0,
    ttft: 0,
    contextTokens: 0,
  });
  let typedPrompt = $state("");
  let results: BenchmarkResult[] = $state([]);
  let step = $state(1);

  let resultsArr: BenchmarkResult[] = [];
  let timer: ReturnType<typeof setTimeout>;
  let chatThreadEl: HTMLDivElement | undefined;

  async function scrollToBottom() {
    await tick();
    if (chatThreadEl) {
      chatThreadEl.scrollTop = chatThreadEl.scrollHeight;
    }
  }

  onMount(() => {
    timer = setTimeout(() => {
      monitor.start(CONFIG.ACTION_TEXTS.INIT);
      const initRes = initAiRuntime();
      agentState = initRes.state;
      messages = [initRes.initialMessage];
      step = 2;
      scrollToBottom();
    }, 400);
  });

  onDestroy(() => {
    clearTimeout(timer);
  });

  $effect(() => {
    if (step > 1) {
      const result = monitor.stop();
      if (result) {
        resultsArr.push({
          action: result.name,
          duration: result.duration,
        });
      }

      if (step <= 10 && result) {
        clearTimeout(timer);
        timer = setTimeout(async () => {
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
          } else if (step === 5) {
            monitor.start(CONFIG.ACTION_TEXTS.CONVERSATION);
            messages = createLargeConversation(25);
            agentState = {
              ...agentState,
              contextTokens: 2840,
              tokensGenerated: agentState.tokensGenerated + 1500,
            };
            step = 6;
          } else if (step === 6) {
            monitor.start(CONFIG.ACTION_TEXTS.STATE);
            agentState = runAgentStateUpdates(agentState);
            step = 7;
          } else if (step === 7) {
            monitor.start(CONFIG.ACTION_TEXTS.STORAGE);
            try { await Promise.race([performStorageIO(), new Promise((r) => setTimeout(r, 5000))]); } catch {}
            step = 8;
          } else if (step === 8) {
            monitor.start(CONFIG.ACTION_TEXTS.CONCURRENT);
            const typing = simulateConcurrentInteraction();
            typedPrompt = typing.typedText;
            step = 9;
          } else if (step === 9) {
            monitor.start(CONFIG.ACTION_TEXTS.CANCEL);
            const cancelRes = simulateCancellation([]);
            messages = [...messages, cancelRes.updatedMessages];
            agentState = cancelRes.cancelledState;
            step = 10;
          } else if (step === 10) {
            monitor.start(CONFIG.ACTION_TEXTS.CLEAR);
            const clearRes = clearSession();
            messages = clearRes.messages;
            agentState = clearRes.state;
            typedPrompt = "";
            step = 11;
          }
          scrollToBottom();
        }, 250);
      } else if (step === 11) {
        results = [...resultsArr];
      }
    }
  });

  const isRunning = $derived(step > 0 && step <= 10);
  const totalTime = $derived(results.reduce((acc, curr) => acc + curr.duration, 0));
</script>

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
      <span class="chip chip-fw">Svelte 5</span>
      <span class="chip">{CONFIG.MODEL_NAME}</span>
      <span class="chip {isRunning ? 'chip-running' : 'chip-status'}">
        {isRunning ? `Running Benchmark... (${step}/10)` : "Ready / Idle"}
      </span>
      <span class="chip">Tokens: {agentState.tokensGenerated}</span>
    </div>
  </div>

  {#if step === 11}
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
          {#each results as res}
            <tr>
              <td>{res.action}</td>
              <td><strong>{res.duration.toFixed(2)}</strong></td>
            </tr>
          {/each}
          <tr class="total-row">
            <td><strong>Total Time</strong></td>
            <td><strong>{totalTime.toFixed(2)}</strong></td>
          </tr>
        </tbody>
      </table>
    </div>
  {/if}

  <div class="chat-workspace">
    <div class="chat-thread" bind:this={chatThreadEl}>
      {#if messages.length === 0}
        <p style="color: var(--text-muted); text-align: center; padding: 40px">
          {CONFIG.UI_TEXT.EMPTY_CHAT}
        </p>
      {:else}
        {#each messages as m (m.id)}
          <div
            class="chat-bubble {m.role === 'user'
              ? 'bubble-user'
              : m.role === 'system'
              ? 'bubble-system'
              : 'bubble-assistant'}"
          >
            <div class="bubble-header">
              <span>{m.role === 'user' ? 'User' : m.role === 'system' ? 'System Core' : 'AI Assistant'}</span>
              <span>{m.timestamp || ''}</span>
            </div>

            {#if m.thinking}
              <div class="agent-thinking">
                <div class="thinking-label">Reasoning Process</div>
                {m.thinking}
              </div>
            {/if}

            {#if m.toolCall}
              <div class="tool-call">
                <span class="tool-badge">Tool: {m.toolCall.name}</span>
                <div><code>Args: {m.toolCall.args}</code></div>
                {#if m.toolCall.result}
                  <div class="tool-result">Result: {m.toolCall.result}</div>
                {/if}
              </div>
            {/if}

            <div class="bubble-content">
              {@html formatMarkdown(m.content)}
            </div>
          </div>
        {/each}
      {/if}
    </div>

    <div class="chat-input-bar">
      <input
        type="text"
        class="agent-input"
        placeholder="Type your message or prompt to local OSS-Agent..."
        value={typedPrompt}
        readonly
      />
      <button class="agent-btn" disabled>
        {isRunning ? "Benchmarking..." : "Benchmark Complete"}
      </button>
    </div>
  </div>
</div>
