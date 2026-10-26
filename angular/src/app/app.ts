import "@shared/config/agent-style.css";
import { Component, OnInit, afterEveryRender, computed, signal } from '@angular/core';
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
} from '@shared/config';

type BenchmarkResult = { action: string; duration: number };

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
})
export class App implements OnInit {
  CONFIG = CONFIG;
  SYSTEM_SPECS = SYSTEM_SPECS;
  messages = signal<Message[]>([]);
  agentState = signal<AgentState>({
    status: 'idle',
    modelName: CONFIG.MODEL_NAME,
    runtime: CONFIG.RUNTIME_DESC,
    tokensGenerated: 0,
    tps: 0,
    ttft: 0,
    contextTokens: 0,
  });
  typedPrompt = signal('');
  results = signal<BenchmarkResult[]>([]);
  step = signal(1);

  isRunning = computed(() => this.step() > 0 && this.step() <= 10);
  totalTime = computed(() => this.results().reduce((acc, curr) => acc + curr.duration, 0));

  private resultsBuffer: BenchmarkResult[] = [];
  private lastProcessedStep = 1;

  constructor() {
    afterEveryRender(() => {
      const currentStep = this.step();
      if (currentStep !== this.lastProcessedStep) {
        this.lastProcessedStep = currentStep;
        this.processStep(currentStep);
      }
    });
  }

  ngOnInit(): void {
    setTimeout(() => {
      monitor.start(CONFIG.ACTION_TEXTS.INIT);
      const initRes = initAiRuntime();
      this.agentState.set(initRes.state);
      this.messages.set([initRes.initialMessage]);
      this.step.set(2);
    }, 400);
  }

  formatMd(content: string): string {
    return formatMarkdown(content);
  }

  private processStep(currentStep: number): void {
    const measurement = monitor.stop();
    if (measurement) {
      this.resultsBuffer.push({
        action: measurement.name,
        duration: measurement.duration,
      });
    }

    if (currentStep > 1 && currentStep <= 10) {
      setTimeout(async () => {
        if (currentStep === 2) {
          monitor.start(CONFIG.ACTION_TEXTS.TTFT);
          const ttftRes = simulateFirstToken();
          this.messages.update((prev) => [...prev, ttftRes.userMsg, ttftRes.assistantMsg]);
          this.agentState.update((prev) => ({
            ...prev,
            status: 'inferencing',
            tokensGenerated: 1,
            ttft: ttftRes.ttftMs,
          }));
          this.step.set(3);
        } else if (currentStep === 3) {
          monitor.start(CONFIG.ACTION_TEXTS.STREAMING);
          const fullContent = getFullStreamedContent();
          this.messages.update((prev) => {
            const next = [...prev];
            const lastIdx = next.length - 1;
            next[lastIdx] = {
              ...next[lastIdx],
              content: fullContent,
              tokens: 148,
            };
            return next;
          });
          this.agentState.update((prev) => ({
            ...prev,
            status: 'streaming',
            tokensGenerated: 148,
            tps: 52.4,
          }));
          this.step.set(4);
        } else if (currentStep === 4) {
          monitor.start(CONFIG.ACTION_TEXTS.TOOL);
          const toolRes = createToolCallingTurn();
          this.messages.update((prev) => [...prev, toolRes.userMsg, toolRes.toolCallMsg]);
          this.agentState.update((prev) => ({
            ...prev,
            status: 'tool_executing',
            tokensGenerated: prev.tokensGenerated + 70,
          }));
          this.step.set(5);
        } else if (currentStep === 5) {
          monitor.start(CONFIG.ACTION_TEXTS.CONVERSATION);
          this.messages.set(createLargeConversation(25));
          this.agentState.update((prev) => ({
            ...prev,
            contextTokens: 2840,
            tokensGenerated: prev.tokensGenerated + 1500,
          }));
          this.step.set(6);
        } else if (currentStep === 6) {
          monitor.start(CONFIG.ACTION_TEXTS.STATE);
          this.agentState.update((prev) => runAgentStateUpdates(prev));
          this.step.set(7);
        } else if (currentStep === 7) {
          monitor.start(CONFIG.ACTION_TEXTS.STORAGE);
          try { await Promise.race([performStorageIO(), new Promise((r) => setTimeout(r, 5000))]); } catch {}
          this.step.set(8);
        } else if (currentStep === 8) {
          monitor.start(CONFIG.ACTION_TEXTS.CONCURRENT);
          const typing = simulateConcurrentInteraction();
          this.typedPrompt.set(typing.typedText);
          this.step.set(9);
        } else if (currentStep === 9) {
          monitor.start(CONFIG.ACTION_TEXTS.CANCEL);
          const cancelRes = simulateCancellation([]);
          this.messages.update((prev) => [...prev, cancelRes.updatedMessages]);
          this.agentState.set(cancelRes.cancelledState);
          this.step.set(10);
        } else if (currentStep === 10) {
          monitor.start(CONFIG.ACTION_TEXTS.CLEAR);
          const clearRes = clearSession();
          this.messages.set(clearRes.messages);
          this.agentState.set(clearRes.state);
          this.typedPrompt.set('');
          this.step.set(11);
        }
      }, 250);
    } else if (currentStep === 11) {
      this.results.set([...this.resultsBuffer]);
    }
  }
}
