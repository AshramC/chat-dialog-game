import type {
  StageDialogConfig,
  StageConfig,
  SingleNode,
  OpenNode,
  ChoiceNode,
  ChoiceOption,
  TimedEvent,
  TopicGroup,
  TimeNode,
  MessageSequence,
  EndingConfig,
  NPCImageNode,
  SystemImageNode,
  NPCVoiceNode,
  NPCVideoNode,
  NPCEmbedNode,
  EndingCardNode,
  SystemNoticeCardNode,
  SingleOutcome,
  TransitionTarget,
} from './types.ts';

// ============================================================
//  Transcript
// ============================================================

type StagedTranscriptEntry =
  | { type: 'time'; text: string }
  | { type: 'system'; text: string }
  | { type: 'friend-add'; text: string }
  | { type: 'npc'; text: string }
  | { type: 'player'; text: string; failed?: boolean }
  | { type: 'npc-image'; node: NPCImageNode }
  | { type: 'system-image'; node: SystemImageNode }
  | { type: 'npc-voice'; node: NPCVoiceNode }
  | { type: 'npc-video'; node: NPCVideoNode }
  | { type: 'npc-embed'; node: NPCEmbedNode }
  | { type: 'ending-card'; node: EndingCardNode }
  | { type: 'system-notice-card'; node: SystemNoticeCardNode }
  | { type: 'error-hint'; text: string };

// ============================================================
//  Snapshot 持久化结构
// ============================================================

const SNAPSHOT_VERSION = 13;
const INVALID_INPUT_SYSTEM_MESSAGE = '信息发送失败，请尝试使用不同的词语重试。';
const INPUT_READY_PLACEHOLDER = '写下你的回应...';
const INPUT_TYPING_PLACEHOLDER = '对方正在输入中...';
const INPUT_ENDED_PLACEHOLDER = '游戏已结束';

interface PersistedPausedStageTimeout {
  stageIndex: number;
  remainingMs: number;
}

type PendingPlaybackAfter =
  | { type: 'none' }
  | { type: 'resume-current' }
  | { type: 'stage-intro-complete'; stageIndex: number }
  | {
      type: 'jump';
      target: TransitionTarget;
      continueAs: ContinueContext;
      pausedStageTimeout?: PersistedPausedStageTimeout | null;
      clearOpenIfTargetNotContinue?: boolean;
    }
  | { type: 'finish-ending'; endingId: string };

interface PendingPlayback {
  messages: MessageSequence;
  nextIndex: number;
  completed: boolean;
  afterComplete: PendingPlaybackAfter;
}

interface PlaySequenceOptions {
  afterComplete?: PendingPlaybackAfter;
  startIndex?: number;
  restoring?: boolean;
}

interface StagedSnapshot {
  version: 13;
  dialogueId: string;
  configSignature: string;
  gameStartedAt: number;
  currentStageIndex: number;
  currentStageEnteredAt: number;
  currentNodeIndex: number;
  openNodeActivatedAt: number | null;
  choiceNodeActivatedAt: number | null;
  preRenderedStage0IntroCount: number;
  singleOutcomes: Record<string, SingleOutcome>;
  triggeredGroups: string[];
  transcript: StagedTranscriptEntry[];
  gameEnded: boolean;
  waitingForFirstMessage: boolean;
  firedTimedEventIndices: number[];
  pendingChoiceEventIndex: number | null;
  pendingPlayback: PendingPlayback | null;
}

interface EngineOptions {
  dialogueId: string;
}

// ============================================================
//  跳转上下文
// ============================================================

/**
 * "continue" 在不同上下文下的含义：
 * - 'after-node'：从 single/open 正常结束而来，continue = 进入 stage 的下一个 node
 * - 'stay-open'：从 open 内部的 group 或 timedEvent-choice 而来，continue = 回到 open
 * - 'after-stage'：从 stage.onTimeout/onComplete 而来，continue = 进入下一个 stage
 */
type ContinueContext = 'after-node' | 'stay-open' | 'after-stage';

type FullscreenPausedTimers = {
  stageIndex: number;
  hadStageTimer: boolean;
  hadOpenTimer: boolean;
  hadChoiceTimer: boolean;
  hadTimedEvents: boolean;
};

// ============================================================
//  StagedDialogEngine
// ============================================================

export class StagedDialogEngine {
  private config: StageDialogConfig;
  private stages: StageConfig[];
  private endings: EndingConfig[];
  private dialogueId: string;

  private gameStartedAt = 0;
  private currentStageIndex = 0;
  private currentStageEnteredAt = 0;
  private currentNodeIndex = 0;
  private openNodeActivatedAt: number | null = null;
  private choiceNodeActivatedAt: number | null = null;
  private singleOutcomes: Record<string, SingleOutcome> = {};
  private triggeredGroups = new Set<string>();
  private transcript: StagedTranscriptEntry[] = [];
  private gameEnded = false;
  private waitingForFirstMessage = true;
  private playbackEpoch = 0;
  private playbackBusy = false;
  private pendingPlayback: PendingPlayback | null = null;
  private preRenderedStage0IntroCount = 0;

  private activeSingleNode: SingleNode | null = null;
  private activeOpenNode: OpenNode | null = null;
  private activeChoiceNode: ChoiceNode | null = null;
  private stageAborted = false;

  private firedTimedEventIndices = new Set<number>();
  private pendingChoiceEventIndex: number | null = null;
  private timedEventTimerIds: number[] = [];

  private stageTimerId: number | null = null;
  private openNodeTimerId: number | null = null;
  private choiceNodeTimerId: number | null = null;
  private fullscreenPauseStartedAt: number | null = null;
  private fullscreenPausedTimers: FullscreenPausedTimers | null = null;
  private fullscreenPauseWaiters: (() => void)[] = [];
  private fullscreenResumeWaiters: (() => void)[] = [];
  private videoCloseCallback: (() => void) | null = null;

  private chatArea: HTMLElement;
  private inputField: HTMLTextAreaElement;
  private sendBtn: HTMLElement;
  private plusBtn: HTMLElement;
  private replySuggestionsEl: HTMLElement;
  private topbarCenter: HTMLElement;
  private contactNameEl: HTMLElement;
  private hintToast: HTMLElement;

  private storageKey: string;
  private configSignature: string;

  constructor(config: StageDialogConfig, options: EngineOptions) {
    this.config = config;
    this.stages = config.stages ?? [];
    this.endings = config.endings ?? [];
    this.dialogueId = options.dialogueId;
    this.storageKey = this.getStorageKey(options.dialogueId);
    this.configSignature = JSON.stringify(config);

    this.validateConfig();

    this.chatArea = this.$('chatArea');
    this.inputField = this.$('inputField') as HTMLTextAreaElement;
    this.sendBtn = this.$('sendBtn');
    this.plusBtn = this.$('plusBtn');
    this.replySuggestionsEl = this.$('replySuggestions');
    this.topbarCenter = this.$('topbarCenter');
    this.contactNameEl = this.$('contactName');
    this.hintToast = this.$('hintToast');

    this.init();
  }

  // ============================================================
  //  配置校验
  // ============================================================

  /**
   * 启动时一次性校验配置。命中问题全部 console.warn，让对话仍能跑起来，
   * 避免一个手滑让整个对话加载失败；真跳转到未知 id 时 resolveJump 会走结局兜底。
   */
  private validateConfig(): void {
    const stageIds = new Set<string>();
    for (const stage of this.stages) {
      if (stageIds.has(stage.id)) {
        console.warn(`[chat-dialog] 重复的 stage id: ${stage.id}`);
      }
      stageIds.add(stage.id);
    }
    const endingIds = new Set(this.endings.map((ending) => ending.id));

    const checkTarget = (target: TransitionTarget | undefined, source: string): void => {
      if (target === undefined) return;
      if (target === 'continue' || target === 'end') return;
      if (!stageIds.has(target) && !endingIds.has(target)) {
        console.warn(`[chat-dialog] ${source} 指向未知的 stage id 或 ending id "${target}"`);
      }
    };

    this.stages.forEach((stage) => {
      checkTarget(stage.onTimeout, `stage[${stage.id}].onTimeout`);
      checkTarget(stage.onComplete, `stage[${stage.id}].onComplete`);

      stage.nodes.forEach((node, nodeIdx) => {
        const isLastNode = nodeIdx === stage.nodes.length - 1;
        const loc = `stage[${stage.id}].nodes[${nodeIdx}]`;

        if (node.type === 'single') {
          checkTarget(node.onPass, `${loc}.onPass`);
          checkTarget(node.onBad, `${loc}.onBad`);
        } else if (node.type === 'open') {
          checkTarget(node.onComplete, `${loc}.onComplete`);
          if (node.duration === undefined && !isLastNode) {
            console.warn(
              `[chat-dialog] ${loc}: open 节点不是 stage 的最后一个 node，必须显式填写 duration`
            );
          }
          if (node.duration !== undefined && node.duration > stage.duration) {
            console.warn(
              `[chat-dialog] ${loc}: open.duration (${node.duration}s) 超过 stage.duration (${stage.duration}s)，` +
              `实际运行时会被截断到 stage 剩余时长`
            );
          }
          node.groups.forEach((group, gIdx) => {
            checkTarget(group.next, `${loc}.groups[${gIdx}:${group.id}].next`);
          });
          node.timedEvents?.forEach((event, eIdx) => {
            const maxAt = node.duration ?? stage.duration;
            if (event.at > maxAt) {
              console.warn(
                `[chat-dialog] ${loc}.timedEvents[${eIdx}].at = ${event.at}s 超出 open/stage 有效时长 ${maxAt}s，无法触发`
              );
            }
            event.choice.options.forEach((opt, oIdx) => {
              checkTarget(opt.next, `${loc}.timedEvents[${eIdx}].choice.options[${oIdx}].next`);
            });
          });
        } else if (node.type === 'choice') {
          checkTarget(node.onTimeout, `${loc}.onTimeout`);
          if (node.duration !== undefined && node.duration > stage.duration) {
            console.warn(
              `[chat-dialog] ${loc}: choice.duration (${node.duration}s) 超过 stage.duration (${stage.duration}s)，` +
              `实际运行时会被截断到 stage 剩余时长`
            );
          }
          node.options.forEach((opt, oIdx) => {
            checkTarget(opt.next, `${loc}.options[${oIdx}].next`);
          });
        }
      });
    });
  }

  // ============================================================
  //  初始化
  // ============================================================

  private $(id: string): HTMLElement { return document.getElementById(id)!; }

  private getStorageKey(dialogueId: string): string {
    return `chat-dialog:${window.location.pathname}:${dialogueId}`;
  }

  private init(): void {
    this.contactNameEl.textContent = this.config.contact.name;
    document.title = this.config.title || this.config.contact.name;
    this.bindNavigation();
    this.bindInputEvents();
    this.replySuggestionsEl.classList.add('hidden');
    if (this.restoreSnapshot()) return;
    this.renderInitialFriendAdd();
    this.renderInitialStagePrelude();
    this.waitingForFirstMessage = true;
    this.enableInput();
    this.persistSnapshot();
  }

  private bindNavigation(): void {
    const backBtn = document.querySelector('.topbar-left') as HTMLButtonElement | null;
    if (backBtn) { backBtn.disabled = true; backBtn.style.display = 'none'; }
    const rightBtns = document.querySelector('.topbar-right') as HTMLElement | null;
    if (rightBtns) rightBtns.style.display = 'none';
    this.topbarCenter.classList.add('topbar-center-only');
    const inputBar = document.querySelector('.input-bar') as HTMLElement | null;
    if (inputBar) inputBar.style.display = '';
  }

  private bindInputEvents(): void {
    this.inputField.addEventListener('input', () => {
      this.resizeInputField();
      this.onInputChange();
    });
    this.inputField.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.onSend(); }
    });
    this.sendBtn.addEventListener('click', () => this.onSend());
  }

  private renderInitialFriendAdd(): void {
    const fa = this.config.friendAdd;
    if (!fa?.enabled) return;
    if (fa.time) this.addTimeStamp(fa.time);
    const sysText = fa.customText || `你已添加了${this.config.contact.name}，以上是打招呼的消息。`;
    this.addFriendAddSystemMessage(sysText);
    if (fa.greeting) this.addPlayerMessage(fa.greeting);
  }

  private renderInitialStagePrelude(): void {
    const firstStage = this.stages[0];
    if (!firstStage?.intro?.length) return;
    let renderedCount = 0;
    for (const node of firstStage.intro) {
      if (node.type !== 'system-notice-card' || node.showBeforeStart === false) break;
      this.addSystemNoticeCard(node);
      renderedCount += 1;
    }
    this.preRenderedStage0IntroCount = renderedCount;
  }

  private renderFirstMessagePrelude(): void {
    const firstStage = this.stages[0];
    if (!firstStage?.intro?.length) return;
    let renderedCount = this.preRenderedStage0IntroCount;
    for (let i = renderedCount; i < firstStage.intro.length; i++) {
      const node = firstStage.intro[i];
      if (node.type !== 'time') break;
      this.addTimeStamp(this.resolveTimeText(node));
      renderedCount += 1;
    }
    this.preRenderedStage0IntroCount = renderedCount;
  }

  // ============================================================
  //  游戏开始
  // ============================================================

  private onSend(): void {
    const text = this.inputField.value.trim();
    if (!text) return;

    if (this.playbackBusy || this.inputField.disabled) {
      this.onInputChange();
      return;
    }

    this.inputField.value = '';
    this.inputField.style.height = 'auto';
    this.onInputChange();

    if (this.waitingForFirstMessage) {
      this.gameStartedAt = Date.now();
      this.renderFirstMessagePrelude();
      this.addPlayerMessage(text);
      this.startGame();
      return;
    }

    if (this.activeSingleNode) { this.handleSingleInput(text); return; }
    if (this.activeChoiceNode) { this.handleChoiceInput(text); return; }
    if (this.activeOpenNode) { this.handleOpenInput(text); return; }
    this.addPlayerMessage(text);
  }

  private startGame(): void {
    if (!this.gameStartedAt) this.gameStartedAt = Date.now();
    this.waitingForFirstMessage = false;
    this.persistSnapshot();
    void this.enterStage(0);
  }

  // ============================================================
  //  跳转解析
  // ============================================================

  /**
   * 统一的跳转目标解析。target 可以是 "continue"、"end"、ending id 或 stage id。
   * ending id 会直接进入指定结局；"end" 才会走结局条件判定。
   * continueAs 告诉这个函数："continue" 在当前上下文里应该变成什么动作。
   */
  private async resolveJump(target: TransitionTarget, continueAs: ContinueContext): Promise<void> {
    this.clearCompletedPendingPlayback();
    if (target === 'end') {
      await this.evaluateEndings();
      return;
    }
    const ending = this.endings.find((item) => item.id === target);
    if (ending) {
      await this.finishWithEnding(ending);
      return;
    }
    if (target === 'continue') {
      switch (continueAs) {
        case 'after-node': this.continueAfterCurrentNode(); return;
        case 'stay-open':  this.returnToActiveOpen();      return;
        case 'after-stage': await this.continueAfterCurrentStage(); return;
      }
      return;
    }
    // stage id 跳转
    const idx = this.stages.findIndex((s) => s.id === target);
    if (idx < 0) {
      console.warn(`[chat-dialog] 未知跳转目标 "${target}"，走结局兜底`);
      await this.evaluateEndings();
      return;
    }
    await this.enterStage(idx);
  }

  /**
   * "continue" 语义：结束当前 node，推进到 stage 内下一个 node；
   * 若已经是最后一个 node，则走 stage.onComplete。
   */
  private continueAfterCurrentNode(): void {
    const stage = this.stages[this.currentStageIndex];
    if (!stage) { void this.evaluateEndings(); return; }
    this.currentNodeIndex++;
    this.persistSnapshot();
    if (this.currentNodeIndex >= stage.nodes.length) {
      void this.resolveJump(stage.onComplete ?? 'continue', 'after-stage');
      return;
    }
    this.enterNodeAt(this.currentNodeIndex);
  }

  /**
   * "continue" 语义：stage 层面结束，进入 stages 数组下一个 stage；
   * 没有下一个就触发结局判定。
   */
  private async continueAfterCurrentStage(): Promise<void> {
    const nextIndex = this.currentStageIndex + 1;
    if (nextIndex >= this.stages.length) {
      await this.evaluateEndings();
      return;
    }
    await this.enterStage(nextIndex);
  }

  /**
   * "continue" 语义：choice 由 open 内部的 timedEvent 弹出，玩家选完后回到 open。
   * 若当前没有活跃的 open（比如 choice 是独立节点），退化为 after-node。
   */
  private returnToActiveOpen(): void {
    if (this.activeOpenNode) {
      this.enableInput(true);
      this.persistSnapshot();
      return;
    }
    this.continueAfterCurrentNode();
  }

  // ============================================================
  //  阶段管理
  // ============================================================

  private async enterStage(index: number): Promise<void> {
    this.invalidatePlayback();
    this.currentStageIndex = index;
    this.currentNodeIndex = 0;
    this.currentStageEnteredAt = Date.now();
    this.activeSingleNode = null;
    this.activeOpenNode = null;
    this.activeChoiceNode = null;
    this.openNodeActivatedAt = null;
    this.choiceNodeActivatedAt = null;
    this.firedTimedEventIndices.clear();
    this.pendingChoiceEventIndex = null;
    this.stageAborted = false;
    this.clearOpenNodeTimer();
    this.clearChoiceNodeTimer();
    this.clearTimedEventTimers();

    const stage = this.stages[index];
    if (!stage) { await this.evaluateEndings(); return; }

    this.scheduleStageTimeout(this.getStageDeadline());

    const introStartIndex = index === 0 ? this.preRenderedStage0IntroCount : 0;
    const introToPlay = stage.intro?.slice(introStartIndex) ?? [];
    this.persistSnapshot();
    if (introToPlay.length > 0) {
      const ok = await this.playMessageSequence(introToPlay, {
        afterComplete: { type: 'stage-intro-complete', stageIndex: index },
      });
      if (!ok || this.stageAborted) return;
      this.clearCompletedPendingPlayback();
    }
    if (stage.nodes.length === 0) {
      await this.resolveJump(stage.onComplete ?? 'continue', 'after-stage');
      return;
    }
    this.enterNodeAt(0);
  }

  private enterNodeAt(nodeIndex: number): void {
    const stage = this.stages[this.currentStageIndex];
    if (!stage) { void this.evaluateEndings(); return; }
    if (nodeIndex >= stage.nodes.length) {
      void this.resolveJump(stage.onComplete ?? 'continue', 'after-stage');
      return;
    }
    this.currentNodeIndex = nodeIndex;
    const node = stage.nodes[nodeIndex];
    if (node.type === 'single') void this.enterSingleNode(node);
    else if (node.type === 'open') void this.enterOpenNode(node, nodeIndex === stage.nodes.length - 1);
    else if (node.type === 'choice') void this.enterChoiceNode(node, null);
  }

  private getStageDeadline(): number {
    const stage = this.stages[this.currentStageIndex];
    if (!stage) return Date.now();
    return this.currentStageEnteredAt + stage.duration * 1000;
  }

  private async playMessageSequence(
    messages: MessageSequence,
    options: PlaySequenceOptions = {},
  ): Promise<boolean> {
    const epoch = this.playbackEpoch;
    this.playbackBusy = true;
    this.lockInputForIncoming();
    const startIndex = Math.min(Math.max(options.startIndex ?? 0, 0), messages.length);
    if (!options.restoring) {
      this.pendingPlayback = {
        messages: [...messages],
        nextIndex: startIndex,
        completed: false,
        afterComplete: options.afterComplete ?? { type: 'none' },
      };
      this.persistSnapshot();
    }
    try {
      for (let i = startIndex; i < messages.length; i++) {
        const node = messages[i];
        if (!this.isPlaybackActive(epoch) || this.stageAborted) return false;
        switch (node.type) {
          case 'npc': {
            await this.waitBeforeMessage(node.pause, node.delay, node.typingDuration, 2000);
            if (!this.isPlaybackActive(epoch) || this.stageAborted) return false;
            this.markPendingPlaybackRendered(i + 1);
            this.addNPCMessage(node.text);
            break;
          }
          case 'npc-image': {
            await this.waitBeforeMessage(node.pause, node.delay, node.typingDuration, 2000);
            if (!this.isPlaybackActive(epoch) || this.stageAborted) return false;
            this.markPendingPlaybackRendered(i + 1);
            this.addImageMessage(node);
            break;
          }
          case 'system-image': {
            const delay = node.delay ?? 2000;
            await this.waitIncomingMessage(delay, node.typingDuration);
            if (!this.isPlaybackActive(epoch) || this.stageAborted) return false;
            this.markPendingPlaybackRendered(i + 1);
            this.addSystemImage(node);
            break;
          }
          case 'npc-voice': {
            await this.waitBeforeMessage(node.pause, node.delay, node.typingDuration, 2000);
            if (!this.isPlaybackActive(epoch) || this.stageAborted) return false;
            this.markPendingPlaybackRendered(i + 1);
            this.addVoiceMessage(node);
            break;
          }
          case 'npc-video': {
            await this.waitBeforeMessage(node.pause, node.delay, node.typingDuration, 2000);
            if (!this.isPlaybackActive(epoch) || this.stageAborted) return false;
            this.markPendingPlaybackRendered(i + 1);
            this.addVideoMessage(node);
            break;
          }
          case 'npc-embed': {
            await this.waitBeforeMessage(node.pause, node.delay, node.typingDuration, 2000);
            if (!this.isPlaybackActive(epoch) || this.stageAborted) return false;
            this.markPendingPlaybackRendered(i + 1);
            this.addEmbedMessage(node);
            break;
          }
          case 'ending-card': {
            const delay = node.delay ?? 2000;
            await this.waitIncomingMessage(delay, node.typingDuration);
            if (!this.isPlaybackActive(epoch) || this.stageAborted) return false;
            this.markPendingPlaybackRendered(i + 1);
            this.addEndingCard(node);
            break;
          }
          case 'system-notice-card': {
            const delay = node.delay ?? 2000;
            await this.waitIncomingMessage(delay, node.typingDuration);
            if (!this.isPlaybackActive(epoch) || this.stageAborted) return false;
            this.markPendingPlaybackRendered(i + 1);
            this.addSystemNoticeCard(node);
            break;
          }
          case 'time':
            this.markPendingPlaybackRendered(i + 1);
            this.addTimeStamp(this.resolveTimeText(node));
            await this.wait(200);
            break;
          case 'system':
            this.markPendingPlaybackRendered(i + 1);
            this.addSystemMessage(node.text);
            await this.wait(400);
            break;
        }
      }
    } finally {
      if (this.isPlaybackActive(epoch)) this.playbackBusy = false;
    }
    const completed = this.isPlaybackActive(epoch) && !this.stageAborted;
    if (completed) {
      this.markPendingPlaybackCompleted();
      const afterComplete = this.pendingPlayback?.afterComplete;
      if (!afterComplete || afterComplete.type === 'none' || afterComplete.type === 'resume-current') {
        this.pendingPlayback = null;
        this.persistSnapshot();
        this.restoreInputForCurrentState();
      }
    }
    return completed;
  }

  // ============================================================
  //  单一节点
  // ============================================================

  private async enterSingleNode(node: SingleNode): Promise<void> {
    this.activeSingleNode = node;
    this.activeOpenNode = null;
    this.activeChoiceNode = null;
    this.choiceNodeActivatedAt = null;
    this.clearChoiceNodeTimer();
    if (node.prompt?.length) {
      const completed = await this.playMessageSequence(node.prompt, {
        afterComplete: { type: 'resume-current' },
      });
      if (!completed || !this.activeSingleNode) return;
    }
    if (!this.activeSingleNode) return;
    this.enableInput(true);
    this.persistSnapshot();
  }

  private handleSingleInput(text: string): void {
    const node = this.activeSingleNode;
    if (!node) return;

    // ── 禁忌词检查（排除词优先）────────────────────────────
    if (node.badKeywords?.length) {
      const isExcluded = node.badExcludeKeywords?.length
        ? this.matchInput(text, 'contains', node.badExcludeKeywords)
        : false;

      if (!isExcluded && this.matchInput(text, node.badKeywordMode ?? 'contains', node.badKeywords)) {
        this.addPlayerMessage(text);
        this.singleOutcomes[node.id] = 'bad';
        this.activeSingleNode = null;
        const pausedStageTimeout = this.pauseStageTimeoutForAcceptedInput();
        this.persistSnapshot();

        const target = node.onBad ?? 'end';
        void (async () => {
          try {
            const seq = this.resolveBadSequence(node.badResponse);
            if (seq) {
              const ok = await this.playMessageSequence(seq, {
                afterComplete: {
                  type: 'jump',
                  target,
                  continueAs: 'after-node',
                  pausedStageTimeout: this.serializePausedStageTimeout(pausedStageTimeout),
                },
              });
              if (!ok) return;
            }
            await this.resolveJump(target, 'after-node');
          } finally {
            this.resumeStageTimeoutAfterAcceptedInput(pausedStageTimeout);
          }
        })();
        return;
      }
    }

    // ── 普通匹配逻辑 ────────────────────────────────────────
    if (this.matchInput(text, node.mode, node.keywords)) {
      this.addPlayerMessage(text);
      this.singleOutcomes[node.id] = 'pass';
      this.activeSingleNode = null;
      const pausedStageTimeout = this.pauseStageTimeoutForAcceptedInput();
      this.persistSnapshot();

      const target = node.onPass ?? 'continue';
      void (async () => {
        try {
          if (node.successResponse?.length) {
            const ok = await this.playMessageSequence(node.successResponse, {
              afterComplete: {
                type: 'jump',
                target,
                continueAs: 'after-node',
                pausedStageTimeout: this.serializePausedStageTimeout(pausedStageTimeout),
              },
            });
            if (!ok) return;
          }
          await this.resolveJump(target, 'after-node');
        } finally {
          this.resumeStageTimeoutAfterAcceptedInput(pausedStageTimeout);
        }
      })();
    } else {
      this.addPlayerMessage(text, true, true);
      if (node.errorHint) this.addErrorHint(node.errorHint);
      this.persistSnapshot();
    }
  }

  // ============================================================
  //  开放节点
  // ============================================================

  /**
   * isLastNode: 调用方告诉我们这个 open 是不是 stage 的最后一个 node。
   * 关系到 duration 省略时的行为。
   */
  private async enterOpenNode(node: OpenNode, isLastNode: boolean): Promise<void> {
    this.activeOpenNode = node;
    this.activeSingleNode = null;
    this.activeChoiceNode = null;
    this.choiceNodeActivatedAt = null;
    this.clearChoiceNodeTimer();
    this.openNodeActivatedAt = Date.now();

    // 决定是否给 open 挂自己的计时器：
    // - duration 省略 + 是最后一个 node：不挂，让 stage timer 统一处理到期
    // - duration 省略 + 不是最后一个 node：配置错误，警告过了；按 stage 剩余时长兜底
    // - duration 填了：挂计时器，但不超过 stage deadline
    const stageDeadline = this.getStageDeadline();
    if (node.duration !== undefined) {
      const openDeadline = this.openNodeActivatedAt + node.duration * 1000;
      const effectiveDeadline = Math.min(openDeadline, stageDeadline);
      this.scheduleOpenNodeTimeout(effectiveDeadline - Date.now());
    } else if (!isLastNode) {
      // 兜底：配置错了，按 stage 剩余时长走
      this.scheduleOpenNodeTimeout(stageDeadline - Date.now());
    }
    // else：最后一个 node 又没填 duration → 不挂 open timer，stage timer 负责

    this.scheduleTimedEvents(node, this.openNodeActivatedAt);

    if (node.prompt?.length) {
      const completed = await this.playMessageSequence(node.prompt, {
        afterComplete: { type: 'resume-current' },
      });
      if (!completed || !this.activeOpenNode) return;
    }
    this.enableInput(true);
    this.persistSnapshot();
  }

  private scheduleTimedEvents(
    node: OpenNode,
    activatedAt: number,
    options: { fireOverdue?: boolean } = {},
  ): void {
    this.clearTimedEventTimers();
    if (!node.timedEvents?.length) return;
    let overdueEvent: { event: TimedEvent; index: number; triggerAt: number } | null = null;
    for (let index = 0; index < node.timedEvents.length; index++) {
      const event = node.timedEvents[index];
      if (this.firedTimedEventIndices.has(index)) continue;
      if (this.pendingChoiceEventIndex === index) continue;
      const triggerAt = activatedAt + event.at * 1000;
      const remaining = triggerAt - Date.now();
      if (remaining <= 0) {
        if (options.fireOverdue && (!overdueEvent || triggerAt < overdueEvent.triggerAt)) {
          overdueEvent = { event, index, triggerAt };
        } else if (!options.fireOverdue) {
          this.firedTimedEventIndices.add(index);
        }
        continue;
      }
      const timerId = window.setTimeout(() => {
        this.firedTimedEventIndices.add(index);
        void this.enterChoiceNode(event.choice, index);
      }, remaining);
      this.timedEventTimerIds.push(timerId);
    }
    if (overdueEvent && !this.activeChoiceNode) {
      this.firedTimedEventIndices.add(overdueEvent.index);
      void this.enterChoiceNode(overdueEvent.event.choice, overdueEvent.index);
    }
  }

  private handleOpenInput(text: string): void {
    const node = this.activeOpenNode;
    if (!node) return;
    const matchedGroup = node.groups.find((g: TopicGroup) =>
      this.matchInput(text, g.mode, g.keywords) && (g.repeatable || !this.triggeredGroups.has(g.id))
    );
    if (matchedGroup) {
      this.addPlayerMessage(text);
      this.triggeredGroups.add(matchedGroup.id);
      if (matchedGroup.recordOutcome) {
        this.singleOutcomes[matchedGroup.recordOutcome.id] = matchedGroup.recordOutcome.outcome;
      }
      const pausedStageTimeout = this.pauseStageTimeoutForAcceptedInput();
      this.persistSnapshot();
      const target = matchedGroup.next ?? 'continue';
      void (async () => {
        try {
          const ok = await this.playMessageSequence(matchedGroup.responses, {
            afterComplete: {
              type: 'jump',
              target,
              continueAs: 'stay-open',
              pausedStageTimeout: this.serializePausedStageTimeout(pausedStageTimeout),
            },
          });
          if (!ok) return;
          await this.resolveJump(target, 'stay-open');
        } finally {
          this.resumeStageTimeoutAfterAcceptedInput(pausedStageTimeout);
        }
      })();
    } else {
      this.addPlayerMessage(text, true, true);
      if (node.defaultResponse?.length) {
        void this.playMessageSequence(node.defaultResponse, {
          afterComplete: { type: 'resume-current' },
        });
      } else {
        this.addErrorHint(INVALID_INPUT_SYSTEM_MESSAGE);
      }
      this.persistSnapshot();
    }
  }

  private onOpenNodeTimeout(): void {
    // 有活跃的 choice（一般是 timedEvent 弹出的）时不打断，让玩家答完。
    if (this.activeChoiceNode) return;

    const node = this.activeOpenNode;
    this.invalidatePlayback();
    this.clearOpenNodeTimer();
    this.clearTimedEventTimers();
    this.activeOpenNode = null;
    this.activeChoiceNode = null;
    this.openNodeActivatedAt = null;
    this.choiceNodeActivatedAt = null;
    this.pendingChoiceEventIndex = null;

    const target = node?.onComplete ?? 'continue';
    this.persistSnapshot();
    void this.resolveJump(target, 'after-node');
  }

  // ============================================================
  //  选择节点
  // ============================================================

  private async enterChoiceNode(node: ChoiceNode, eventIndex: number | null): Promise<void> {
    this.activeChoiceNode = node;
    this.pendingChoiceEventIndex = eventIndex;
    this.choiceNodeActivatedAt = null;
    this.clearChoiceNodeTimer();
    if (node.prompt?.length) {
      const completed = await this.playMessageSequence(node.prompt, {
        afterComplete: { type: 'resume-current' },
      });
      if (!completed || !this.activeChoiceNode) return;
    }
    this.enableInput(true);
    this.choiceNodeActivatedAt = Date.now();
    this.scheduleChoiceNodeTimeoutForActiveChoice();
    this.persistSnapshot();
  }

  private handleChoiceInput(text: string): void {
    const node = this.activeChoiceNode;
    if (!node) return;
    const matchedOption = node.options.find((opt: ChoiceOption) =>
      this.matchInput(text, opt.mode, opt.keywords)
    );
    if (matchedOption) {
      this.addPlayerMessage(text);
      if (matchedOption.recordOutcome) {
        this.singleOutcomes[matchedOption.recordOutcome.id] = matchedOption.recordOutcome.outcome;
      }
      const cameFromOpenTimedEvent = this.pendingChoiceEventIndex !== null && this.activeOpenNode !== null;
      const target = matchedOption.next ?? 'continue';
      this.activeChoiceNode = null;
      this.pendingChoiceEventIndex = null;
      this.choiceNodeActivatedAt = null;
      this.clearChoiceNodeTimer();
      const pausedStageTimeout = this.pauseStageTimeoutForAcceptedInput();
      this.persistSnapshot();

      void (async () => {
        try {
          if (matchedOption.response?.length) {
            const completed = await this.playMessageSequence(matchedOption.response, {
              afterComplete: {
                type: 'jump',
                target,
                continueAs: cameFromOpenTimedEvent ? 'stay-open' : 'after-node',
                pausedStageTimeout: this.serializePausedStageTimeout(pausedStageTimeout),
                clearOpenIfTargetNotContinue: true,
              },
            });
            if (!completed) return;
          }
          // choice 跳走（非 continue）时清理 open 相关状态
          if (target !== 'continue') {
            this.clearOpenNodeTimer();
            this.clearTimedEventTimers();
            this.activeOpenNode = null;
            this.openNodeActivatedAt = null;
            this.firedTimedEventIndices.clear();
            this.persistSnapshot();
          }
          await this.resolveJump(target, cameFromOpenTimedEvent ? 'stay-open' : 'after-node');
        } finally {
          this.resumeStageTimeoutAfterAcceptedInput(pausedStageTimeout);
        }
      })();
    } else {
      this.addPlayerMessage(text, true, true);
      if (node.defaultResponse?.length) {
        void this.playMessageSequence(node.defaultResponse, {
          afterComplete: { type: 'resume-current' },
        });
      }
      else this.addErrorHint(INVALID_INPUT_SYSTEM_MESSAGE);
      this.persistSnapshot();
    }
  }

  private scheduleChoiceNodeTimeoutForActiveChoice(): void {
    this.clearChoiceNodeTimer();
    const node = this.activeChoiceNode;
    if (!node || node.duration === undefined || this.choiceNodeActivatedAt === null) return;
    const choiceDeadline = this.choiceNodeActivatedAt + node.duration * 1000;
    const effectiveDeadline = Math.min(choiceDeadline, this.getStageDeadline());
    this.scheduleChoiceNodeTimeout(effectiveDeadline - Date.now());
  }

  private onChoiceNodeTimeout(): void {
    const node = this.activeChoiceNode;
    if (!node) return;

    this.clearChoiceNodeTimer();
    const cameFromOpenTimedEvent = this.pendingChoiceEventIndex !== null && this.activeOpenNode !== null;
    const target = node.onTimeout ?? 'continue';

    if (node.timeoutOutcome) {
      this.singleOutcomes[node.timeoutOutcome.id] = node.timeoutOutcome.outcome;
    }

    this.activeChoiceNode = null;
    this.pendingChoiceEventIndex = null;
    this.choiceNodeActivatedAt = null;
    this.persistSnapshot();

    void (async () => {
      if (node.timeoutResponse?.length) {
        const completed = await this.playMessageSequence(node.timeoutResponse, {
          afterComplete: {
            type: 'jump',
            target,
            continueAs: cameFromOpenTimedEvent ? 'stay-open' : 'after-node',
            clearOpenIfTargetNotContinue: true,
          },
        });
        if (!completed) return;
      }
      if (target !== 'continue') {
        this.clearOpenNodeTimer();
        this.clearTimedEventTimers();
        this.activeOpenNode = null;
        this.openNodeActivatedAt = null;
        this.firedTimedEventIndices.clear();
        this.persistSnapshot();
      }
      await this.resolveJump(target, cameFromOpenTimedEvent ? 'stay-open' : 'after-node');
    })();
  }

  // ============================================================
  //  阶段超时
  // ============================================================

  private onStageTimeout(): void {
    const stage = this.stages[this.currentStageIndex];
    this.invalidatePlayback();
    this.clearStageTimer();
    this.clearOpenNodeTimer();
    this.clearChoiceNodeTimer();
    this.clearTimedEventTimers();
    this.stageAborted = true;

    // 当前活跃的 single 记 fail，本 stage 后续没触达过的 single 也记 fail，
    // 这样结局条件能判"超时未完成"。
    if (this.activeSingleNode) {
      if (!(this.activeSingleNode.id in this.singleOutcomes)) {
        this.singleOutcomes[this.activeSingleNode.id] = 'fail';
      }
      this.activeSingleNode = null;
    }
    if (stage) {
      for (let i = this.currentNodeIndex + 1; i < stage.nodes.length; i++) {
        const n = stage.nodes[i];
        if (n.type === 'single' && !(n.id in this.singleOutcomes)) {
          this.singleOutcomes[n.id] = 'fail';
        }
      }
    }
    this.activeOpenNode = null;
    this.activeChoiceNode = null;
    this.openNodeActivatedAt = null;
    this.choiceNodeActivatedAt = null;
    this.pendingChoiceEventIndex = null;

    const target = stage?.onTimeout ?? 'continue';
    this.persistSnapshot();
    void this.resolveJump(target, 'after-stage');
  }

  // ============================================================
  //  结局判定
  // ============================================================

  private async evaluateEndings(): Promise<void> {
    const matched = this.endings.find((ending) => {
      const c = ending.condition;
      if (c.default) return true;
      const passOk = !c.requiredPasses || c.requiredPasses.every((id) => this.singleOutcomes[id] === 'pass');
      const failOk = !c.requiredFails || c.requiredFails.every((id) => this.singleOutcomes[id] === 'fail');
      const badOk = !c.requiredBads || c.requiredBads.every((id) => this.singleOutcomes[id] === 'bad');
      const anyBadOk = !c.anyBad || Object.values(this.singleOutcomes).includes('bad');
      return passOk && failOk && badOk && anyBadOk;
    });

    await this.finishWithEnding(matched);
  }

  private async finishWithEnding(ending: EndingConfig | undefined): Promise<void> {
    this.invalidatePlayback();
    this.clearStageTimer();
    this.clearOpenNodeTimer();
    this.clearChoiceNodeTimer();
    this.clearTimedEventTimers();
    this.stageAborted = false;
    this.activeSingleNode = null;
    this.activeOpenNode = null;
    this.activeChoiceNode = null;
    this.openNodeActivatedAt = null;
    this.choiceNodeActivatedAt = null;
    this.pendingChoiceEventIndex = null;
    this.lockInputForGameEnded();

    if (ending) {
      if (ending.intro?.length) {
        await this.playMessageSequence(ending.intro, {
          afterComplete: { type: 'finish-ending', endingId: ending.id },
        });
        this.clearCompletedPendingPlayback();
      }
      const card = this.resolveEndingCard(ending);
      if (card) this.addEndingCard(card);
    }
    this.gameEnded = true;
    this.lockInputForGameEnded();
    this.persistSnapshot();
  }

  private resolveEndingCard(ending: EndingConfig): EndingCardNode | undefined {
    const modal = ending.modal ?? (ending.id.startsWith('bad-end-') ? this.config.defaultBadEndingModal : undefined);
    if (!modal) return undefined;
    return {
      type: 'ending-card',
      title: modal.title,
      body: modal.body,
      restartButtonText: modal.buttonText,
      restartUrl: modal.redirectUrl,
    };
  }

  // ============================================================
  //  输入匹配
  // ============================================================

  private matchInput(text: string, mode: string, keywords?: string[]): boolean {
    const normalizedInput = this.normalizeInput(text);
    const normalizedKeywords = (keywords || []).map((k) => this.normalizeInput(k));
    switch (mode) {
      case 'any': return true;
      case 'keyword': return normalizedKeywords.some((k) => normalizedInput === k);
      case 'contains': return normalizedKeywords.some((k) => k.length > 0 && normalizedInput.includes(k));
      default: return true;
    }
  }

  // ============================================================
  //  计时器管理
  // ============================================================

  private scheduleStageTimeout(deadlineMs: number): void {
    this.clearStageTimer();
    const remaining = deadlineMs - Date.now();
    if (remaining <= 0) { this.onStageTimeout(); return; }
    this.stageTimerId = window.setTimeout(() => this.onStageTimeout(), remaining);
  }

  private pauseStageTimeoutForAcceptedInput(): { stageIndex: number; playbackEpoch: number; remainingMs: number } | null {
    if (this.stageTimerId === null) return null;
    const remainingMs = Math.max(0, this.getStageDeadline() - Date.now());
    const paused = {
      stageIndex: this.currentStageIndex,
      playbackEpoch: this.playbackEpoch,
      remainingMs,
    };
    this.clearStageTimer();
    return paused;
  }

  private resumeStageTimeoutAfterAcceptedInput(
    paused: { stageIndex: number; playbackEpoch: number; remainingMs: number } | null,
  ): void {
    if (!paused) return;
    if (this.gameEnded || this.stageAborted) return;
    if (this.currentStageIndex !== paused.stageIndex) return;
    if (this.playbackEpoch !== paused.playbackEpoch) return;

    const stage = this.stages[this.currentStageIndex];
    if (!stage) return;
    const durationMs = stage.duration * 1000;
    this.currentStageEnteredAt = Date.now() + paused.remainingMs - durationMs;
    this.scheduleStageTimeout(Date.now() + paused.remainingMs);
    this.persistSnapshot();
  }

  private serializePausedStageTimeout(
    paused: { stageIndex: number; remainingMs: number } | null,
  ): PersistedPausedStageTimeout | null {
    if (!paused) return null;
    return {
      stageIndex: paused.stageIndex,
      remainingMs: paused.remainingMs,
    };
  }

  private resumePersistedStageTimeout(paused: PersistedPausedStageTimeout | null | undefined): void {
    if (!paused) return;
    if (this.gameEnded || this.stageAborted) return;
    if (this.currentStageIndex !== paused.stageIndex) return;

    const stage = this.stages[this.currentStageIndex];
    if (!stage) return;
    const durationMs = stage.duration * 1000;
    this.currentStageEnteredAt = Date.now() + paused.remainingMs - durationMs;
    this.scheduleStageTimeout(Date.now() + paused.remainingMs);
    this.persistSnapshot();
  }

  private beginFullscreenPause(): void {
    if (this.fullscreenPauseStartedAt !== null) return;
    this.fullscreenPauseStartedAt = Date.now();
    this.fullscreenPausedTimers = {
      stageIndex: this.currentStageIndex,
      hadStageTimer: this.stageTimerId !== null,
      hadOpenTimer: this.openNodeTimerId !== null,
      hadChoiceTimer: this.choiceNodeTimerId !== null,
      hadTimedEvents: this.timedEventTimerIds.length > 0,
    };
    this.clearStageTimer();
    this.clearOpenNodeTimer();
    this.clearChoiceNodeTimer();
    this.clearTimedEventTimers();
    const waiters = this.fullscreenPauseWaiters.splice(0);
    waiters.forEach(resolve => resolve());
  }

  private endFullscreenPause(): void {
    if (this.fullscreenPauseStartedAt === null) return;
    const elapsed = Date.now() - this.fullscreenPauseStartedAt;
    const paused = this.fullscreenPausedTimers;
    this.fullscreenPauseStartedAt = null;
    this.fullscreenPausedTimers = null;

    if (paused && !this.gameEnded && !this.stageAborted && this.currentStageIndex === paused.stageIndex) {
      if (paused.hadStageTimer) {
        this.currentStageEnteredAt += elapsed;
        this.scheduleStageTimeout(this.getStageDeadline());
      }

      if (this.activeOpenNode && this.openNodeActivatedAt !== null) {
        this.openNodeActivatedAt += elapsed;
        if (paused.hadOpenTimer) this.scheduleOpenNodeTimeoutForActiveOpen();
        if (paused.hadTimedEvents) this.scheduleTimedEvents(this.activeOpenNode, this.openNodeActivatedAt);
      }

      if (this.activeChoiceNode && this.choiceNodeActivatedAt !== null) {
        this.choiceNodeActivatedAt += elapsed;
        if (paused.hadChoiceTimer) this.scheduleChoiceNodeTimeoutForActiveChoice();
      }

      this.persistSnapshot();
    }

    const waiters = this.fullscreenResumeWaiters.splice(0);
    waiters.forEach(resolve => resolve());
  }

  private scheduleOpenNodeTimeoutForActiveOpen(): void {
    const stage = this.stages[this.currentStageIndex];
    const node = this.activeOpenNode;
    if (!stage || !node || this.openNodeActivatedAt === null) return;
    const stageDeadline = this.getStageDeadline();
    if (node.duration !== undefined) {
      const openDeadline = this.openNodeActivatedAt + node.duration * 1000;
      const effectiveDeadline = Math.min(openDeadline, stageDeadline);
      this.scheduleOpenNodeTimeout(effectiveDeadline - Date.now());
    } else if (this.currentNodeIndex !== stage.nodes.length - 1) {
      this.scheduleOpenNodeTimeout(stageDeadline - Date.now());
    }
  }

  private scheduleOpenNodeTimeout(remainingMs: number): void {
    this.clearOpenNodeTimer();
    if (remainingMs <= 0) { this.onOpenNodeTimeout(); return; }
    this.openNodeTimerId = window.setTimeout(() => this.onOpenNodeTimeout(), remainingMs);
  }

  private scheduleChoiceNodeTimeout(remainingMs: number): void {
    this.clearChoiceNodeTimer();
    if (remainingMs <= 0) { this.onChoiceNodeTimeout(); return; }
    this.choiceNodeTimerId = window.setTimeout(() => this.onChoiceNodeTimeout(), remainingMs);
  }

  private clearStageTimer(): void {
    if (this.stageTimerId !== null) { clearTimeout(this.stageTimerId); this.stageTimerId = null; }
  }

  private clearOpenNodeTimer(): void {
    if (this.openNodeTimerId !== null) { clearTimeout(this.openNodeTimerId); this.openNodeTimerId = null; }
  }

  private clearChoiceNodeTimer(): void {
    if (this.choiceNodeTimerId !== null) { clearTimeout(this.choiceNodeTimerId); this.choiceNodeTimerId = null; }
  }

  private clearTimedEventTimers(): void {
    for (const id of this.timedEventTimerIds) clearTimeout(id);
    this.timedEventTimerIds = [];
  }

  // ============================================================
  //  持久化
  // ============================================================

  private persistSnapshot(): void {
    try {
      const snapshot: StagedSnapshot = {
        version: SNAPSHOT_VERSION,
        dialogueId: this.dialogueId,
        configSignature: this.configSignature,
        gameStartedAt: this.gameStartedAt,
        currentStageIndex: this.currentStageIndex,
        currentStageEnteredAt: this.currentStageEnteredAt,
        currentNodeIndex: this.currentNodeIndex,
        openNodeActivatedAt: this.openNodeActivatedAt,
        choiceNodeActivatedAt: this.choiceNodeActivatedAt,
        preRenderedStage0IntroCount: this.preRenderedStage0IntroCount,
        singleOutcomes: { ...this.singleOutcomes },
        triggeredGroups: Array.from(this.triggeredGroups),
        transcript: this.transcript,
        gameEnded: this.gameEnded,
        waitingForFirstMessage: this.waitingForFirstMessage,
        firedTimedEventIndices: Array.from(this.firedTimedEventIndices),
        pendingChoiceEventIndex: this.pendingChoiceEventIndex,
        pendingPlayback: this.pendingPlayback,
      };
      window.localStorage.setItem(this.storageKey, JSON.stringify(snapshot));
    } catch { /* ignore */ }
  }

  private readSnapshot(): StagedSnapshot | null {
    try {
      const raw = window.localStorage.getItem(this.storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<StagedSnapshot>;
      if (parsed.version !== SNAPSHOT_VERSION) return null;
      if (parsed.dialogueId !== this.dialogueId) return null;
      if (parsed.configSignature !== this.configSignature) return null;
      if (!Array.isArray(parsed.transcript)) return null;
      if (parsed.pendingPlayback !== null && parsed.pendingPlayback !== undefined) {
        if (!Array.isArray(parsed.pendingPlayback.messages)) return null;
        if (typeof parsed.pendingPlayback.nextIndex !== 'number') return null;
        if (typeof parsed.pendingPlayback.completed !== 'boolean') return null;
        if (!parsed.pendingPlayback.afterComplete) return null;
      }
      if (typeof parsed.gameStartedAt !== 'number') return null;
      if (typeof parsed.currentStageEnteredAt !== 'number') return null;
      if (typeof parsed.preRenderedStage0IntroCount !== 'number') return null;
      if (typeof parsed.choiceNodeActivatedAt !== 'number' && parsed.choiceNodeActivatedAt !== null) return null;
      return parsed as StagedSnapshot;
    } catch { return null; }
  }

  private clearSnapshot(): void {
    try { window.localStorage.removeItem(this.storageKey); } catch { /* ignore */ }
  }

  private restoreSnapshot(): boolean {
    const snapshot = this.readSnapshot();
    if (!snapshot) return false;
    this.gameStartedAt = snapshot.gameStartedAt;
    this.currentStageIndex = snapshot.currentStageIndex;
    this.currentStageEnteredAt = snapshot.currentStageEnteredAt;
    this.currentNodeIndex = snapshot.currentNodeIndex;
    this.openNodeActivatedAt = snapshot.openNodeActivatedAt;
    this.choiceNodeActivatedAt = snapshot.choiceNodeActivatedAt;
    this.preRenderedStage0IntroCount = snapshot.preRenderedStage0IntroCount;
    this.singleOutcomes = { ...snapshot.singleOutcomes };
    this.triggeredGroups = new Set(snapshot.triggeredGroups);
    this.transcript = [...snapshot.transcript];
    this.gameEnded = snapshot.gameEnded;
    this.waitingForFirstMessage = snapshot.waitingForFirstMessage;
    this.firedTimedEventIndices = new Set(snapshot.firedTimedEventIndices ?? []);
    this.pendingChoiceEventIndex = snapshot.pendingChoiceEventIndex ?? null;
    this.pendingPlayback = snapshot.pendingPlayback ?? null;
    this.chatArea.innerHTML = '';
    this.transcript.forEach((entry) => this.renderTranscriptEntry(entry));
    this.resumeAfterRestore();
    this.onInputChange();
    this.scrollToBottom();
    return true;
  }

  private resumeAfterRestore(): void {
    const now = Date.now();
    if (this.waitingForFirstMessage) {
      this.enableInput();
      return;
    }
    if (this.gameEnded) {
      this.lockInputForGameEnded();
      return;
    }
    const stage = this.stages[this.currentStageIndex];
    if (!stage) { void this.evaluateEndings(); return; }

    const stageDeadline = this.getStageDeadline();
    if (this.pendingPlayback) {
      const pausesStage = this.pendingPlayback.afterComplete.type === 'jump'
        && !!this.pendingPlayback.afterComplete.pausedStageTimeout;
      const isEndingPlayback = this.pendingPlayback.afterComplete.type === 'finish-ending';
      if (!pausesStage && !isEndingPlayback && now >= stageDeadline) {
        void this.onStageTimeoutFromRestore();
        return;
      }
      void this.resumePendingPlayback();
      return;
    }

    // 如果当前 stage 早就过期，走 onTimeout 让流程自然推进。
    if (now >= stageDeadline) {
      void this.onStageTimeoutFromRestore();
      return;
    }

    // 还在有效期内：恢复当前活跃节点
    this.restoreActiveNode(now);
    if (this.currentNodeIndex >= stage.nodes.length) {
      void this.resolveJump(stage.onComplete ?? 'continue', 'after-stage');
      return;
    }

    this.scheduleStageTimeout(stageDeadline);

    if (this.activeOpenNode && this.openNodeActivatedAt !== null) {
      const openNode = this.activeOpenNode;
      if (openNode.duration !== undefined) {
        const openDeadline = this.openNodeActivatedAt + openNode.duration * 1000;
        const effectiveDeadline = Math.min(openDeadline, stageDeadline);
        this.scheduleOpenNodeTimeout(effectiveDeadline - now);
      } else {
        const isLastNode = this.currentNodeIndex === stage.nodes.length - 1;
        if (!isLastNode) this.scheduleOpenNodeTimeout(stageDeadline - now);
        // 最后一个 node 且没 duration：不挂 open timer
      }
      if (this.pendingChoiceEventIndex !== null) {
        const event = openNode.timedEvents?.[this.pendingChoiceEventIndex];
        if (event) this.activeChoiceNode = event.choice;
      }
      this.scheduleTimedEvents(openNode, this.openNodeActivatedAt, { fireOverdue: true });
    }
    if (this.activeChoiceNode) {
      if (this.choiceNodeActivatedAt === null) this.choiceNodeActivatedAt = now;
      if (this.activeChoiceNode.duration !== undefined) {
        const choiceDeadline = this.choiceNodeActivatedAt + this.activeChoiceNode.duration * 1000;
        const effectiveDeadline = Math.min(choiceDeadline, stageDeadline);
        if (now >= effectiveDeadline) {
          this.onChoiceNodeTimeout();
          return;
        }
        this.scheduleChoiceNodeTimeout(effectiveDeadline - now);
      }
    }
    this.restoreInputForCurrentState(true);
    this.persistSnapshot();
  }

  private async resumePendingPlayback(): Promise<void> {
    const pending = this.pendingPlayback;
    if (!pending) return;

    const pausesStage = pending.afterComplete.type === 'jump'
      && !!pending.afterComplete.pausedStageTimeout;
    const isEndingPlayback = pending.afterComplete.type === 'finish-ending';
    if (pending.afterComplete.type === 'jump' && pending.afterComplete.continueAs === 'stay-open') {
      this.restoreActiveOpenNodeForPendingPlayback();
    }
    if (!pausesStage && !isEndingPlayback) {
      const stage = this.stages[this.currentStageIndex];
      if (stage) this.scheduleStageTimeout(this.getStageDeadline());
    }

    this.lockInputForIncoming();

    if (!pending.completed) {
      const completed = await this.playMessageSequence(pending.messages, {
        startIndex: pending.nextIndex,
        restoring: true,
      });
      if (!completed) return;
    }

    await this.completePendingPlayback(pending.afterComplete);
  }

  private async completePendingPlayback(afterComplete: PendingPlaybackAfter): Promise<void> {
    this.pendingPlayback = null;
    switch (afterComplete.type) {
      case 'none':
      case 'resume-current':
        this.resumeAfterRestore();
        return;

      case 'stage-intro-complete': {
        if (this.currentStageIndex !== afterComplete.stageIndex) {
          this.resumeAfterRestore();
          return;
        }
        const stage = this.stages[this.currentStageIndex];
        if (!stage) { await this.evaluateEndings(); return; }
        if (stage.nodes.length === 0) {
          await this.resolveJump(stage.onComplete ?? 'continue', 'after-stage');
          return;
        }
        this.enterNodeAt(0);
        return;
      }

      case 'jump':
        try {
          if (afterComplete.continueAs === 'stay-open') {
            this.restoreActiveOpenNodeForPendingPlayback();
          }
          if (afterComplete.clearOpenIfTargetNotContinue && afterComplete.target !== 'continue') {
            this.clearOpenNodeTimer();
            this.clearTimedEventTimers();
            this.activeOpenNode = null;
            this.openNodeActivatedAt = null;
            this.firedTimedEventIndices.clear();
            this.persistSnapshot();
          }
          await this.resolveJump(afterComplete.target, afterComplete.continueAs);
        } finally {
          this.resumePersistedStageTimeout(afterComplete.pausedStageTimeout);
        }
        return;

      case 'finish-ending': {
        const ending = this.endings.find((item) => item.id === afterComplete.endingId);
        if (ending) {
          const card = this.resolveEndingCard(ending);
          if (card) this.addEndingCard(card);
        }
        this.gameEnded = true;
        this.lockInputForGameEnded();
        this.persistSnapshot();
        return;
      }
    }
  }

  private restoreActiveOpenNodeForPendingPlayback(): void {
    const stage = this.stages[this.currentStageIndex];
    if (!stage) return;
    const node = stage.nodes[this.currentNodeIndex];
    if (!node || node.type !== 'open') return;

    const now = Date.now();
    const activatedAt = this.openNodeActivatedAt ?? this.currentStageEnteredAt;
    const stageDeadline = this.getStageDeadline();
    const openDeadlineRaw = node.duration !== undefined
      ? activatedAt + node.duration * 1000
      : stageDeadline;
    const openDeadline = Math.min(stageDeadline, openDeadlineRaw);
    if (now >= openDeadline) return;

    this.openNodeActivatedAt = activatedAt;
    this.activeOpenNode = node;
    if (node.duration !== undefined) {
      this.scheduleOpenNodeTimeout(openDeadline - now);
    } else if (this.currentNodeIndex !== stage.nodes.length - 1) {
      this.scheduleOpenNodeTimeout(stageDeadline - now);
    }
    this.scheduleTimedEvents(node, activatedAt);
  }

  /**
   * 快照恢复发现当前 stage 已过期时用。
   * 和 onStageTimeout 做同样的事（标 fail、执行 onTimeout 跳转），
   * 但不需要清计时器（因为根本没挂起来）。
   */
  private async onStageTimeoutFromRestore(): Promise<void> {
    const stage = this.stages[this.currentStageIndex];
    if (!stage) { await this.evaluateEndings(); return; }
    this.stageAborted = true;
    for (let i = this.currentNodeIndex; i < stage.nodes.length; i++) {
      const n = stage.nodes[i];
      if (n.type === 'single' && !(n.id in this.singleOutcomes)) {
        this.singleOutcomes[n.id] = 'fail';
      }
    }
    this.activeSingleNode = null;
    this.activeOpenNode = null;
    this.activeChoiceNode = null;
    this.openNodeActivatedAt = null;
    this.choiceNodeActivatedAt = null;
    this.pendingChoiceEventIndex = null;
    const target = stage.onTimeout ?? 'continue';
    this.persistSnapshot();
    await this.resolveJump(target, 'after-stage');
  }

  private restoreActiveNode(now: number): void {
    this.activeSingleNode = null;
    this.activeOpenNode = null;
    this.activeChoiceNode = null;
    const stage = this.stages[this.currentStageIndex];
    if (!stage) { this.openNodeActivatedAt = null; return; }
    while (this.currentNodeIndex < stage.nodes.length) {
      const node = stage.nodes[this.currentNodeIndex];
      if (node.type === 'single') {
        if (!(node.id in this.singleOutcomes)) {
          this.openNodeActivatedAt = null;
          this.activeSingleNode = node;
          return;
        }
        this.currentNodeIndex++;
        continue;
      }
      if (node.type === 'open') {
        const activatedAt = this.openNodeActivatedAt ?? this.currentStageEnteredAt;
        const stageDeadline = this.getStageDeadline();
        const openDeadlineRaw = node.duration !== undefined
          ? activatedAt + node.duration * 1000
          : stageDeadline;
        const openDeadline = Math.min(stageDeadline, openDeadlineRaw);
        if (now >= openDeadline) { this.openNodeActivatedAt = null; this.currentNodeIndex++; continue; }
        this.openNodeActivatedAt = activatedAt;
        this.activeOpenNode = node;
        return;
      }
      if (node.type === 'choice') {
        this.activeChoiceNode = node;
        return;
      }
      this.currentNodeIndex++;
    }
    this.openNodeActivatedAt = null;
  }

  private appendTranscript(entry: StagedTranscriptEntry): void {
    this.transcript.push(entry);
    this.persistSnapshot();
  }

  private markPendingPlaybackRendered(nextIndex: number): void {
    if (!this.pendingPlayback) return;
    this.pendingPlayback = {
      ...this.pendingPlayback,
      nextIndex,
    };
  }

  private markPendingPlaybackCompleted(): void {
    if (!this.pendingPlayback) return;
    this.pendingPlayback = {
      ...this.pendingPlayback,
      completed: true,
      nextIndex: this.pendingPlayback.messages.length,
    };
    this.persistSnapshot();
  }

  private clearCompletedPendingPlayback(): void {
    if (!this.pendingPlayback?.completed) return;
    this.pendingPlayback = null;
  }

  private renderTranscriptEntry(entry: StagedTranscriptEntry): void {
    switch (entry.type) {
      case 'time': this.addTimeStamp(entry.text, false); break;
      case 'system': this.addSystemMessage(entry.text, false); break;
      case 'friend-add': this.addFriendAddSystemMessage(entry.text, false); break;
      case 'npc': this.addNPCMessage(entry.text, false); break;
      case 'player': this.addPlayerMessage(entry.text, false, entry.failed); break;
      case 'npc-image': this.addImageMessage(entry.node, false); break;
      case 'system-image': this.addSystemImage(entry.node, false); break;
      case 'npc-voice': this.addVoiceMessage(entry.node, false); break;
      case 'npc-video': this.addVideoMessage(entry.node, false); break;
      case 'npc-embed': this.addEmbedMessage(entry.node, false); break;
      case 'ending-card': this.addEndingCard(entry.node, false); break;
      case 'system-notice-card': this.addSystemNoticeCard(entry.node, false); break;
      case 'error-hint': this.addErrorHint(entry.text, false); break;
    }
  }

  // ============================================================
  //  DOM 渲染
  // ============================================================

  private createAvatar(isPlayer: boolean): HTMLElement {
    const div = document.createElement('div');
    div.className = 'msg-avatar';
    const url = isPlayer ? this.config.playerAvatar : this.config.contact.avatar;
    if (url) {
      const img = document.createElement('img');
      img.src = url; img.alt = '';
      div.appendChild(img);
    } else {
      const colors = isPlayer ? ['#5B9BD5', '#3A7CC1'] : ['#E88B6A', '#D06A48'];
      div.style.background = `linear-gradient(135deg, ${colors[0]}, ${colors[1]})`;
      div.innerHTML = `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="20" cy="15" r="7" fill="rgba(255,255,255,0.85)"/>
        <ellipse cx="20" cy="34" rx="12" ry="10" fill="rgba(255,255,255,0.85)"/>
      </svg>`;
    }
    return div;
  }

  private addNPCMessage(text: string, persist = true): void {
    const row = document.createElement('div');
    row.className = 'msg-row';
    row.appendChild(this.createAvatar(false));
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.textContent = text;
    row.appendChild(bubble);
    this.chatArea.appendChild(row);
    this.scrollToBottom();
    if (persist) this.appendTranscript({ type: 'npc', text });
  }

  private addPlayerMessage(text: string, persist = true, failed = false): void {
    const row = document.createElement('div');
    row.className = 'msg-row is-player';
    row.appendChild(this.createAvatar(true));
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.textContent = text;
    row.appendChild(bubble);
    if (failed) {
      const badge = document.createElement('div');
      badge.className = 'msg-failed-badge';
      badge.textContent = '!';
      row.appendChild(badge);
    }
    this.chatArea.appendChild(row);
    this.scrollToBottom();
    if (persist) this.appendTranscript({ type: 'player', text, failed });
  }

  private addErrorHint(text: string, persist = true): void {
    const div = document.createElement('div');
    div.className = 'msg-system';
    div.textContent = text;
    this.chatArea.appendChild(div);
    this.scrollToBottom();
    if (persist) this.appendTranscript({ type: 'error-hint', text });
  }

  private addVoiceMessage(node: NPCVoiceNode, persist = true): void {
    const row = document.createElement('div');
    row.className = 'msg-row';
    row.appendChild(this.createAvatar(false));
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble voice-bubble';
    const dur = node.duration || 1;
    bubble.style.width = Math.min(200, 80 + dur * 10) + 'px';
    const waves = document.createElement('div');
    waves.className = 'voice-waves';
    waves.innerHTML = '<span></span><span></span><span></span>';
    const durLabel = document.createElement('span');
    durLabel.className = 'voice-duration';
    durLabel.textContent = dur + '"';
    const dot = document.createElement('div');
    dot.className = 'voice-unread';
    bubble.appendChild(waves);
    bubble.appendChild(durLabel);
    row.appendChild(bubble);
    row.appendChild(dot);
    this.chatArea.appendChild(row);
    this.scrollToBottom();
    let audio: HTMLAudioElement | null = null;
    let playing = false;
    bubble.addEventListener('click', () => {
      document.querySelectorAll('.voice-bubble.is-playing').forEach(el => el.classList.remove('is-playing'));
      if (playing) {
        audio?.pause();
        if (audio) audio.currentTime = 0;
        bubble.classList.remove('is-playing');
        playing = false;
        return;
      }
      dot.classList.add('hidden');
      if (node.src) {
        audio = new Audio(node.src);
        audio.play().catch(() => {});
        audio.onended = () => { bubble.classList.remove('is-playing'); playing = false; };
      } else {
        setTimeout(() => { bubble.classList.remove('is-playing'); playing = false; }, dur * 1000);
      }
      bubble.classList.add('is-playing');
      playing = true;
    });
    if (persist) this.appendTranscript({ type: 'npc-voice', node: { ...node } });
  }

  private addVideoMessage(node: NPCVideoNode, persist = true): void {
    const row = document.createElement('div');
    row.className = 'msg-row';
    row.appendChild(this.createAvatar(false));
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble video-bubble';
    const thumb = document.createElement('div');
    thumb.className = 'video-thumb';
    if (node.poster) {
      const img = document.createElement('img');
      img.src = node.poster;
      thumb.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'video-thumb-placeholder';
      ph.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round">
        <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/>
        <line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/>
        <line x1="2" y1="12" x2="22" y2="12"/>
        <line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/>
        <line x1="17" y1="7" x2="22" y2="7"/><line x1="17" y1="17" x2="22" y2="17"/>
      </svg>`;
      thumb.appendChild(ph);
    }
    const playBtn = document.createElement('div');
    playBtn.className = 'video-play-btn';
    playBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="#fff"><polygon points="6 3 20 12 6 21"/></svg>`;
    thumb.appendChild(playBtn);
    bubble.appendChild(thumb);
    row.appendChild(bubble);
    this.chatArea.appendChild(row);
    this.scrollToBottom();
    // 兼容老字段：advanceOnClose 在 stage 图模式里意义变模糊了，这里保守地走 stage.onComplete。
    if (node.advanceOnClose) {
      this.videoCloseCallback = () => {
        const stage = this.stages[this.currentStageIndex];
        this.clearStageTimer();
        this.clearOpenNodeTimer();
        this.clearChoiceNodeTimer();
        this.clearTimedEventTimers();
        void this.resolveJump(stage?.onComplete ?? 'continue', 'after-stage');
      };
    }
    bubble.addEventListener('click', () => this.openVideoFullscreen(node));
    if (persist) this.appendTranscript({ type: 'npc-video', node: { ...node } });
  }

  private addEmbedMessage(node: NPCEmbedNode, persist = true): void {
    const row = document.createElement('div');
    row.className = 'msg-row';
    row.appendChild(this.createAvatar(false));
    const bubble = document.createElement('div');
    if (node.appName) {
      bubble.className = 'msg-bubble embed-bubble is-miniprogram';
      const content = document.createElement('div');
      content.className = 'miniprogram-content';
      const titleEl = document.createElement('div');
      titleEl.className = 'miniprogram-title';
      titleEl.textContent = node.title || node.url;
      content.appendChild(titleEl);
      if (node.cover) {
        const coverEl = document.createElement('div');
        coverEl.className = 'miniprogram-cover';
        const img = document.createElement('img');
        img.src = node.cover; img.alt = '';
        coverEl.appendChild(img);
        content.appendChild(coverEl);
      }
      bubble.appendChild(content);
      const footer = document.createElement('div');
      footer.className = 'miniprogram-footer';
      if (node.appIcon) {
        const icon = document.createElement('img');
        icon.className = 'miniprogram-icon'; icon.src = node.appIcon; icon.alt = '';
        footer.appendChild(icon);
      } else {
        const iconDefault = document.createElement('div');
        iconDefault.className = 'miniprogram-icon-default';
        footer.appendChild(iconDefault);
      }
      const name = document.createElement('span');
      name.className = 'miniprogram-name'; name.textContent = node.appName;
      footer.appendChild(name);
      const label = document.createElement('span');
      label.className = 'miniprogram-label'; label.textContent = '小程序';
      footer.appendChild(label);
      bubble.appendChild(footer);
    } else {
      bubble.className = 'msg-bubble embed-bubble';
      const titleEl = document.createElement('div');
      titleEl.className = 'embed-title';
      titleEl.textContent = node.title || node.url;
      bubble.appendChild(titleEl);
      const body = document.createElement('div');
      body.className = 'embed-body';
      if (node.description) {
        const desc = document.createElement('div');
        desc.className = 'embed-desc'; desc.textContent = node.description;
        body.appendChild(desc);
      }
      if (node.cover) {
        const thumbEl = document.createElement('div');
        thumbEl.className = 'embed-thumb';
        const img = document.createElement('img');
        img.src = node.cover; img.alt = '';
        thumbEl.appendChild(img);
        body.appendChild(thumbEl);
      }
      bubble.appendChild(body);
      if (node.articleSource) {
        const sourceEl = document.createElement('div');
        sourceEl.className = 'embed-source';
        sourceEl.textContent = node.articleSource;
        bubble.appendChild(sourceEl);
      }
    }
    row.appendChild(bubble);
    this.chatArea.appendChild(row);
    this.scrollToBottom();
    bubble.addEventListener('click', () => this.openEmbedFullscreen(node));
    if (persist) this.appendTranscript({ type: 'npc-embed', node: { ...node } });
  }

  private addEndingCard(node: EndingCardNode, persist = true): void {
    const card = document.createElement('section');
    card.className = 'ending-card-system';
    const title = document.createElement('div');
    title.className = 'ending-card-title';
    title.textContent = node.title;
    card.appendChild(title);
    const body = document.createElement('div');
    body.className = 'ending-card-body';
    body.textContent = node.body;
    card.appendChild(body);
    if (node.hintTitle || node.hintText) {
      const hint = document.createElement('div');
      hint.className = 'ending-card-hint';
      if (node.hintTitle) {
        const ht = document.createElement('div');
        ht.className = 'ending-card-hint-title';
        ht.textContent = node.hintTitle;
        hint.appendChild(ht);
      }
      if (node.hintText) {
        const hb = document.createElement('div');
        hb.className = 'ending-card-hint-body';
        hb.textContent = node.hintText;
        hint.appendChild(hb);
      }
      card.appendChild(hint);
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ending-card-action';
    btn.textContent = node.restartButtonText || '重新开始';
    btn.addEventListener('click', () => {
      if (node.restartUrl) {
        this.restartDialogue(node.restartUrl);
        return;
      }
      if (node.restartButtonText) {
        btn.disabled = true;
        btn.textContent = '已完成';
        return;
      }
      this.restartDialogue();
    });
    card.appendChild(btn);
    this.chatArea.appendChild(card);
    this.scrollToBottom();
    if (persist) this.appendTranscript({ type: 'ending-card', node: { ...node } });
  }

  private addSystemNoticeCard(node: SystemNoticeCardNode, persist = true): void {
    const card = document.createElement('section');
    card.className = 'system-notice-card';
    const header = document.createElement('div');
    header.className = 'system-notice-card-header';
    header.textContent = '提示';
    card.appendChild(header);
    const title = document.createElement('div');
    title.className = 'system-notice-card-title';
    title.textContent = node.title;
    card.appendChild(title);
    if (node.description) {
      const desc = document.createElement('div');
      desc.className = 'system-notice-card-description';
      desc.textContent = node.description;
      card.appendChild(desc);
    }
    const list = document.createElement('ol');
    list.className = 'system-notice-card-list';
    for (const itemText of node.items) {
      const item = document.createElement('li');
      item.className = 'system-notice-card-item';
      item.textContent = itemText;
      list.appendChild(item);
    }
    card.appendChild(list);
    if (node.footer) {
      const footer = document.createElement('div');
      footer.className = 'system-notice-card-footer';
      footer.textContent = node.footer;
      card.appendChild(footer);
    }
    this.chatArea.appendChild(card);
    this.scrollToBottom();
    if (persist) this.appendTranscript({ type: 'system-notice-card', node: { ...node, items: [...node.items] } });
  }

  private addSystemImage(node: SystemImageNode, persist = true): void {
    const card = document.createElement('section');
    card.className = 'system-image-card';
    const img = document.createElement('img');
    img.src = node.src; img.alt = node.alt || '';
    this.scrollToBottomAfterImageLoad(img);
    card.appendChild(img);
    card.addEventListener('click', () => this.openImageFullscreen(node.src));
    this.chatArea.appendChild(card);
    this.scrollToBottom();
    if (persist) this.appendTranscript({ type: 'system-image', node: { ...node } });
  }

  private addImageMessage(node: NPCImageNode, persist = true): void {
    const row = document.createElement('div');
    row.className = 'msg-row';
    row.appendChild(this.createAvatar(false));
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble image-bubble';
    const img = document.createElement('img');
    img.src = node.src; img.alt = '';
    this.scrollToBottomAfterImageLoad(img);
    bubble.appendChild(img);
    row.appendChild(bubble);
    this.chatArea.appendChild(row);
    this.scrollToBottom();
    bubble.addEventListener('click', () => this.openImageFullscreen(node.src));
    if (persist) this.appendTranscript({ type: 'npc-image', node: { ...node } });
  }

  private addTimeStamp(text: string, persist = true): void {
    const div = document.createElement('div');
    div.className = 'msg-time';
    div.textContent = text;
    this.chatArea.appendChild(div);
    if (persist) this.appendTranscript({ type: 'time', text });
  }

  private resolveTimeText(node: TimeNode): string {
    if (node.useCurrentTime || !node.text) return this.formatCurrentTime(new Date());
    return node.text;
  }

  private formatCurrentTime(date: Date): string {
    const hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const period = hours < 12 ? '上午' : '下午';
    const displayHour = hours % 12 === 0 ? 12 : hours % 12;
    return `${period} ${displayHour}:${minutes}`;
  }

  private addSystemMessage(text: string, persist = true): void {
    const div = document.createElement('div');
    div.className = 'msg-system';
    div.textContent = text;
    this.chatArea.appendChild(div);
    this.scrollToBottom();
    if (persist) this.appendTranscript({ type: 'system', text });
  }

  private addFriendAddSystemMessage(text: string, persist = true): void {
    const div = document.createElement('div');
    div.className = 'msg-system friend-add';
    div.textContent = text;
    this.chatArea.appendChild(div);
    this.scrollToBottom();
    if (persist) this.appendTranscript({ type: 'friend-add', text });
  }

  private openEmbedFullscreen(node: NPCEmbedNode): void {
    const overlay = this.$('videoFullscreen');
    const content = this.$('fsContent');
    const closeBtn = this.$('fsClose');
    closeBtn.hidden = true;
    content.classList.remove('image-preview');
    content.innerHTML = '';
    content.style.width = '100%';
    content.style.height = '100%';
    content.style.transform = 'translate(-50%, -50%)';
    const iframe = document.createElement('iframe');
    let src = node.url;
    if (src.startsWith('//') && location.protocol === 'file:') src = 'https:' + src;
    iframe.src = src;
    iframe.setAttribute('allowfullscreen', 'true');
    iframe.setAttribute('allow', 'autoplay; encrypted-media; fullscreen');
    content.appendChild(iframe);
    overlay.classList.add('active');
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;
      if (typeof event.data !== 'object' || event.data === null) return;
      if (!('type' in event.data) || event.data.type !== 'chat-dialog:close-embed') return;
      close();
    };
    const close = () => {
      overlay.classList.remove('active');
      setTimeout(() => { content.innerHTML = ''; }, 300);
      closeBtn.removeEventListener('click', close);
      overlay.removeEventListener('click', bgClose);
      window.removeEventListener('message', handleMessage);
      closeBtn.hidden = false;
    };
    const bgClose = (e: Event) => { if (e.target === overlay) close(); };
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', bgClose);
    window.addEventListener('message', handleMessage);
  }

  private openImageFullscreen(src: string): void {
    const overlay = this.$('videoFullscreen');
    const content = this.$('fsContent');
    const closeBtn = this.$('fsClose');
    closeBtn.hidden = false;
    content.classList.add('image-preview');
    content.innerHTML = '';
    content.style.width = '100%';
    content.style.height = '100%';
    content.style.transform = 'translate(-50%, -50%)';
    const img = document.createElement('img');
    img.src = src; img.className = 'fs-image';
    content.appendChild(img);
    overlay.classList.add('active');
    const close = () => {
      overlay.classList.remove('active');
      setTimeout(() => {
        content.innerHTML = '';
        content.classList.remove('image-preview');
      }, 300);
      closeBtn.removeEventListener('click', close);
      overlay.removeEventListener('click', bgClose);
    };
    const bgClose = (e: Event) => { if (e.target === overlay) close(); };
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', bgClose);
  }

  private openVideoFullscreen(node: NPCVideoNode): void {
    this.beginFullscreenPause();
    const overlay = this.$('videoFullscreen');
    const content = this.$('fsContent');
    const closeBtn = this.$('fsClose');
    closeBtn.hidden = false;
    content.classList.remove('image-preview');
    content.innerHTML = '';
    const frame = document.querySelector('.phone-frame') as HTMLElement;
    const frameW = frame.clientWidth;
    const frameH = frame.clientHeight;
    const videoW = frameH;
    const videoH = Math.min(frameW, frameH * 9 / 16);
    content.style.width = videoW + 'px';
    content.style.height = videoH + 'px';
    content.style.transform = `translate(-50%, -50%) rotate(90deg)`;
    if (node.iframe) {
      const iframe = document.createElement('iframe');
      let src = node.iframe;
      if (src.startsWith('//') && location.protocol === 'file:') src = 'https:' + src;
      if (!src.includes('autoplay')) src += (src.includes('?') ? '&' : '?') + 'autoplay=1';
      iframe.src = src;
      iframe.setAttribute('allowfullscreen', 'true');
      iframe.setAttribute('allow', 'autoplay; encrypted-media; fullscreen');
      iframe.setAttribute('scrolling', 'no');
      content.appendChild(iframe);
    } else if (node.src) {
      const video = document.createElement('video');
      video.controls = true; video.autoplay = true; video.playsInline = true;
      video.src = node.src;
      if (node.poster) video.poster = node.poster;
      content.appendChild(video);
    }
    overlay.classList.add('active');
    const close = () => {
      overlay.classList.remove('active');
      setTimeout(() => { content.innerHTML = ''; }, 300);
      closeBtn.removeEventListener('click', close);
      overlay.removeEventListener('click', bgClose);
      const cb = this.videoCloseCallback;
      this.videoCloseCallback = null;
      if (cb) cb();
      this.endFullscreenPause();
    };
    const bgClose = (e: Event) => { if (e.target === overlay) close(); };
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', bgClose);
  }

  private setTyping(on: boolean): void {
    this.topbarCenter.classList.toggle('is-typing', on);
  }

  private lockInputForIncoming(): void {
    this.inputField.disabled = true;
    this.inputField.placeholder = INPUT_TYPING_PLACEHOLDER;
    this.onInputChange();
  }

  private lockInputForGameEnded(): void {
    this.inputField.disabled = true;
    this.inputField.placeholder = INPUT_ENDED_PLACEHOLDER;
    this.onInputChange();
  }

  private enableInput(focus = false): void {
    this.inputField.disabled = false;
    this.inputField.placeholder = INPUT_READY_PLACEHOLDER;
    this.onInputChange();
    if (focus) this.inputField.focus();
  }

  private restoreInputForCurrentState(focus = false): void {
    const hasActiveNode =
      this.activeSingleNode !== null ||
      this.activeOpenNode !== null ||
      this.activeChoiceNode !== null;
    if (this.gameEnded) {
      this.lockInputForGameEnded();
      return;
    }

    const canInput = !this.playbackBusy && (this.waitingForFirstMessage || hasActiveNode);

    if (canInput) {
      this.enableInput(focus);
      return;
    }

    this.inputField.disabled = true;
    this.inputField.placeholder = this.playbackBusy ? INPUT_TYPING_PLACEHOLDER : INPUT_READY_PLACEHOLDER;
    this.onInputChange();
  }

  private scrollToBottom(): void {
    requestAnimationFrame(() => { this.chatArea.scrollTop = this.chatArea.scrollHeight; });
  }

  private scrollToBottomAfterImageLoad(img: HTMLImageElement): void {
    if (img.complete) {
      this.scrollToBottom();
      return;
    }
    img.addEventListener('load', () => this.scrollToBottom(), { once: true });
  }

  private onInputChange(): void {
    const canSend = !this.inputField.disabled && !this.playbackBusy;
    const hasText = canSend && this.inputField.value.trim().length > 0;
    this.sendBtn.classList.toggle('visible', hasText);
    this.plusBtn.classList.toggle('hidden', hasText);
  }

  private resizeInputField(): void {
    this.inputField.style.height = 'auto';
    this.inputField.style.height = Math.min(this.inputField.scrollHeight, 100) + 'px';
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private showToast(_text: string): void {
    this.hintToast.textContent = _text;
    this.hintToast.classList.add('show');
    setTimeout(() => this.hintToast.classList.remove('show'), 1800);
  }

  private wait(ms: number): Promise<void> {
    return this.waitWithFullscreenPause(ms);
  }

  private async waitWithFullscreenPause(ms: number): Promise<void> {
    let remaining = Math.max(0, ms);
    while (remaining > 0) {
      if (this.fullscreenPauseStartedAt !== null) {
        await this.waitForFullscreenResume();
        continue;
      }

      const startedAt = Date.now();
      const result = await this.waitUntilTimeoutOrFullscreenPause(remaining);
      if (result === 'timeout') return;
      remaining = Math.max(0, remaining - (Date.now() - startedAt));
    }
  }

  private waitUntilTimeoutOrFullscreenPause(ms: number): Promise<'timeout' | 'paused'> {
    if (this.fullscreenPauseStartedAt !== null) return Promise.resolve('paused');
    return new Promise(resolve => {
      let settled = false;
      let pauseWaiter: (() => void) | null = null;
      const settle = (result: 'timeout' | 'paused') => {
        if (settled) return;
        settled = true;
        clearTimeout(timerId);
        if (pauseWaiter) {
          this.fullscreenPauseWaiters = this.fullscreenPauseWaiters.filter(waiter => waiter !== pauseWaiter);
        }
        resolve(result);
      };
      const timerId = window.setTimeout(() => settle('timeout'), ms);
      pauseWaiter = () => settle('paused');
      this.fullscreenPauseWaiters.push(pauseWaiter);
    });
  }

  private waitForFullscreenResume(): Promise<void> {
    if (this.fullscreenPauseStartedAt === null) return Promise.resolve();
    return new Promise(resolve => {
      this.fullscreenResumeWaiters.push(resolve);
    });
  }

  private async waitIncomingMessage(totalDelay: number, typingDuration?: number): Promise<void> {
    const safeTotalDelay = Math.max(0, totalDelay);
    const safeTypingDuration = Math.min(Math.max(0, typingDuration ?? safeTotalDelay), safeTotalDelay);
    const silentDelay = safeTotalDelay - safeTypingDuration;
    if (silentDelay > 0) await this.wait(silentDelay);
    if (safeTypingDuration > 0) {
      this.setTyping(true);
      await this.wait(safeTypingDuration);
      this.setTyping(false);
    }
  }

  /**
   * 统一处理消息前的等待逻辑，支持 pause（新模型）和 delay（旧模型）。
   * - pause 存在：先静默等待 pause ms，再显示“正在输入...” typing ms
   * - pause 不存在：走旧的 delay / typingDuration 模型
   */
  private async waitBeforeMessage(
    pause: number | undefined,
    delay: number | undefined,
    typingDuration: number | undefined,
    defaultDelay: number,
  ): Promise<void> {
    if (pause !== undefined) {
      if (pause > 0) await this.wait(pause);
      const typing = typingDuration ?? defaultDelay;
      if (typing > 0) {
        this.setTyping(true);
        await this.wait(typing);
        this.setTyping(false);
      }
    } else {
      const totalDelay = delay ?? defaultDelay;
      await this.waitIncomingMessage(totalDelay, typingDuration);
    }
  }

  private estimateDelay(text: string): number {
    const len = text.length;
    if (len <= 3) return 600 + Math.random() * 300;
    if (len <= 10) return 1000 + Math.random() * 500;
    if (len <= 20) return 1500 + Math.random() * 500;
    return 2000 + Math.random() * 800;
  }

  private normalizeInput(value: string): string {
    return value
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\u3000\s]+/g, ' ')
      .replace(/[，。！？；：、""''（）【】《》〈〉「」『』,.!?;:'"()[\]{}<>/_\\-]/g, '')
      .trim();
  }

  private invalidatePlayback(): void {
    this.playbackEpoch += 1;
    this.playbackBusy = false;
    this.pendingPlayback = null;
    this.setTyping(false);
    this.clearTimedEventTimers();
  }

  private isPlaybackActive(epoch: number): boolean {
    return epoch === this.playbackEpoch;
  }

  /**
   * 解析 bad 过场消息序列：优先节点级、其次全局。
   */
  private resolveBadSequence(nodeResponse?: MessageSequence): MessageSequence | null {
    if (nodeResponse?.length) return nodeResponse;
    const global = this.config.badSequence;
    return global?.length ? global : null;
  }

  private restartDialogue(targetUrl?: string): void {
    this.clearSnapshot();
    const nextUrl = targetUrl || `${window.location.pathname}${window.location.search}`;
    window.location.href = nextUrl;
  }
}
