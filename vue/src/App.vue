<script setup lang="ts">
import "@shared/config/agent-style.css";
import { ref, watch, onMounted, nextTick } from "vue";
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

const messages = ref<Message[]>([]);
const agentState = ref<AgentState>({
  status: "idle",
  modelName: CONFIG.MODEL_NAME,
  runtime: CONFIG.RUNTIME_DESC,
  tokensGenerated: 0,
  tps: 0,
  ttft: 0,
  contextTokens: 0,
});
const typedPrompt = ref("");
const results = ref<BenchmarkResult[]>([]);
const step = ref<number>(1);
const chatThreadRef = ref<HTMLDivElement | null>(null);

const resultsBuffer: BenchmarkResult[] = [];

const scrollToBottom = async () => {
  await nextTick();
  if (chatThreadRef.value) {
    chatThreadRef.value.scrollTop = chatThreadRef.value.scrollHeight;
  }
};

onMounted(() => {
  setTimeout(() => {
    monitor.start(CONFIG.ACTION_TEXTS.INIT);
    const initRes = initAiRuntime();
    agentState.value = initRes.state;
    messages.value = [initRes.initialMessage];
    step.value = 2;
    scrollToBottom();
  }, 400);
});

watch(step, (newStep) => {
  const measurement = monitor.stop();
  if (measurement) {
    resultsBuffer.push({
      action: measurement.name,
      duration: measurement.duration,
    });
  }

  if (newStep > 1 && newStep <= 10) {
    const timer = setTimeout(async () => {
      if (newStep === 2) {
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
      } else if (newStep === 3) {
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
      } else if (newStep === 4) {
        monitor.start(CONFIG.ACTION_TEXTS.TOOL);
        const toolRes = createToolCallingTurn();
        messages.value = [...messages.value, toolRes.userMsg, toolRes.toolCallMsg];
        agentState.value = {
          ...agentState.value,
          status: "tool_executing",
          tokensGenerated: agentState.value.tokensGenerated + 70,
        };
        step.value = 5;
      } else if (newStep === 5) {
        monitor.start(CONFIG.ACTION_TEXTS.CONVERSATION);
        messages.value = createLargeConversation(25);
        agentState.value = {
          ...agentState.value,
          contextTokens: 2840,
          tokensGenerated: agentState.value.tokensGenerated + 1500,
        };
        step.value = 6;
      } else if (newStep === 6) {
        monitor.start(CONFIG.ACTION_TEXTS.STATE);
        agentState.value = runAgentStateUpdates(agentState.value);
        step.value = 7;
      } else if (newStep === 7) {
        monitor.start(CONFIG.ACTION_TEXTS.STORAGE);
        try { await Promise.race([performStorageIO(), new Promise((r) => setTimeout(r, 5000))]); } catch {}
        step.value = 8;
      } else if (newStep === 8) {
        monitor.start(CONFIG.ACTION_TEXTS.CONCURRENT);
        const typing = simulateConcurrentInteraction();
        typedPrompt.value = typing.typedText;
        step.value = 9;
      } else if (newStep === 9) {
        monitor.start(CONFIG.ACTION_TEXTS.CANCEL);
        const cancelRes = simulateCancellation([]);
        messages.value = [...messages.value, cancelRes.updatedMessages];
        agentState.value = cancelRes.cancelledState;
        step.value = 10;
      } else if (newStep === 10) {
        monitor.start(CONFIG.ACTION_TEXTS.CLEAR);
        const clearRes = clearSession();
        messages.value = clearRes.messages;
        agentState.value = clearRes.state;
        typedPrompt.value = "";
        step.value = 11;
      }
      scrollToBottom();
    }, 250);
    return () => clearTimeout(timer);
  } else if (newStep === 11) {
    results.value = [...resultsBuffer];
  }
});
</script>

<template>
  <div class="agent-app">
    <div class="agent-header">
      <div>
        <div class="header-title-wrap">
          <h1>{{ CONFIG.UI_TEXT.TITLE }}</h1>
          <p>{{ CONFIG.UI_TEXT.SUBTITLE }}</p>
        </div>
        <div class="specs-bar">
          <span class="spec-chip">OS: <strong>{{ SYSTEM_SPECS.os }}</strong></span>
          <span class="spec-chip">CPU: <strong>{{ SYSTEM_SPECS.cpu }}</strong></span>
          <span class="spec-chip">NPU: <strong>{{ SYSTEM_SPECS.npu }}</strong></span>
          <span class="spec-chip">Cores: <strong>{{ SYSTEM_SPECS.cores }}</strong></span>
          <span class="spec-chip">RAM: <strong>{{ SYSTEM_SPECS.ram }}</strong></span>
          <span class="spec-chip">Engine: <strong>{{ SYSTEM_SPECS.engine }}</strong></span>
        </div>
      </div>
      <div class="badge-row">
        <span class="chip chip-fw">Vue 3</span>
        <span class="chip">{{ CONFIG.MODEL_NAME }}</span>
        <span :class="['chip', step > 0 && step <= 10 ? 'chip-running' : 'chip-status']">
          {{ step > 0 && step <= 10 ? `Running Benchmark... (${step}/10)` : "Ready / Idle" }}
        </span>
        <span class="chip">Tokens: {{ agentState.tokensGenerated }}</span>
      </div>
    </div>

    <div v-if="step === 11" class="results-container">
      <h2>Benchmark Results</h2>
      <table border="1" class="benchmark-table">
        <thead>
          <tr>
            <th>Action</th>
            <th>Duration (ms)</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(res, idx) in results" :key="idx">
            <td>{{ res.action }}</td>
            <td><strong>{{ res.duration.toFixed(2) }}</strong></td>
          </tr>
          <tr class="total-row">
            <td><strong>Total Time</strong></td>
            <td><strong>{{ results.reduce((acc, curr) => acc + curr.duration, 0).toFixed(2) }}</strong></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="chat-workspace">
      <div class="chat-thread" ref="chatThreadRef">
        <p v-if="messages.length === 0" style="color: var(--text-muted); text-align: center; padding: 40px">
          {{ CONFIG.UI_TEXT.EMPTY_CHAT }}
        </p>
        <template v-else>
          <div
            v-for="m in messages"
            :key="m.id"
            :class="[
              'chat-bubble',
              m.role === 'user' ? 'bubble-user' : m.role === 'system' ? 'bubble-system' : 'bubble-assistant'
            ]"
          >
            <div class="bubble-header">
              <span>{{ m.role === 'user' ? 'User' : m.role === 'system' ? 'System Core' : 'AI Assistant' }}</span>
              <span>{{ m.timestamp || '' }}</span>
            </div>

            <div v-if="m.thinking" class="agent-thinking">
              <div class="thinking-label">Reasoning Process</div>
              {{ m.thinking }}
            </div>

            <div v-if="m.toolCall" class="tool-call">
              <span class="tool-badge">Tool: {{ m.toolCall.name }}</span>
              <div><code>Args: {{ m.toolCall.args }}</code></div>
              <div v-if="m.toolCall.result" class="tool-result">Result: {{ m.toolCall.result }}</div>
            </div>

            <div class="bubble-content" v-html="formatMarkdown(m.content)"></div>
          </div>
        </template>
      </div>

      <div class="chat-input-bar">
        <input
          type="text"
          class="agent-input"
          placeholder="Type your message or prompt to local OSS-Agent..."
          :value="typedPrompt"
          readonly
        />
        <button class="agent-btn" disabled>
          {{ step > 0 && step <= 10 ? "Benchmarking..." : "Benchmark Complete" }}
        </button>
      </div>
    </div>
  </div>
</template>
