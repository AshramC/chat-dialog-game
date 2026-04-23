// ============================================================
//  基础共享类型
// ============================================================

/** 角色信息 */
export interface ContactConfig {
  name: string;
  /** 头像 URL，留空使用默认 SVG 头像 */
  avatar?: string;
}

/** 添加好友提示配置 */
export interface FriendAddConfig {
  enabled: boolean;
  /** 添加好友的时间戳 */
  time?: string;
  /** 玩家打招呼的消息（显示为玩家气泡） */
  greeting?: string;
  /** 自定义系统提示文字，不填则自动生成 */
  customText?: string;
}

// ============================================================
//  Intro / 媒体节点类型（供 intro 字段使用）
// ============================================================

/** NPC 自动发言节点 */
export interface NPCNode {
  type: 'npc';
  text: string;
  /**
   * 消息出现前的纯静默等待时间(ms)。
   * 优先于 delay：当 pause 存在时，总等待 = pause + typingDuration。
   * typingDuration 不填时使用当前消息类型的默认输入时长。
   */
  pause?: number;
  delay?: number;
  typingDuration?: number;
}

/** NPC 语音消息节点 */
export interface NPCVoiceNode {
  type: 'npc-voice';
  src?: string;
  duration: number;
  pause?: number;
  delay?: number;
  typingDuration?: number;
}

/** NPC 图片消息节点 */
export interface NPCImageNode {
  type: 'npc-image';
  src: string;
  pause?: number;
  delay?: number;
  typingDuration?: number;
}

/** 系统图片节点 */
export interface SystemImageNode {
  type: 'system-image';
  src: string;
  alt?: string;
  delay?: number;
  typingDuration?: number;
}

/** NPC 视频消息节点 */
export interface NPCVideoNode {
  type: 'npc-video';
  src?: string;
  iframe?: string;
  poster?: string;
  duration?: string;
  pause?: number;
  delay?: number;
  typingDuration?: number;
  /** 关闭视频全屏后自动进入下一阶段 */
  advanceOnClose?: boolean;
}

/** NPC 网页内嵌节点 */
export interface NPCEmbedNode {
  type: 'npc-embed';
  url: string;
  title?: string;
  description?: string;
  cover?: string;
  pause?: number;
  delay?: number;
  typingDuration?: number;
  appName?: string;
  appIcon?: string;
  articleSource?: string;
}

/** 时间戳节点 */
export interface TimeNode {
  type: 'time';
  text?: string;
  /** 使用节点触发时的真实本地时间 */
  useCurrentTime?: boolean;
}

/** 系统消息节点 */
export interface SystemNode {
  type: 'system';
  text: string;
}

/** 内嵌结局卡片节点 */
export interface EndingCardNode {
  type: 'ending-card';
  title: string;
  body: string;
  hintTitle?: string;
  hintText?: string;
  restartButtonText?: string;
  restartUrl?: string;
  delay?: number;
  typingDuration?: number;
}

/** 系统须知卡片节点 */
export interface SystemNoticeCardNode {
  type: 'system-notice-card';
  title: string;
  description?: string;
  items: string[];
  footer?: string;
  /** 是否在首条消息之前直接显示；默认 true */
  showBeforeStart?: boolean;
  delay?: number;
  typingDuration?: number;
}

/** Intro 节点联合类型：阶段开场/结局前自动播放 */
export type IntroNode =
  | NPCNode
  | NPCImageNode
  | SystemImageNode
  | NPCVoiceNode
  | NPCVideoNode
  | NPCEmbedNode
  | EndingCardNode
  | SystemNoticeCardNode
  | TimeNode
  | SystemNode;

/** 可顺序播放的一组消息 */
export type MessageSequence = IntroNode[];

// ============================================================
//  分阶段对话系统类型
// ============================================================

/** single 节点的三种结果 */
export type SingleOutcome = 'pass' | 'fail' | 'bad';

/**
 * 跳转目标。字符串值域：
 * - "continue" → 留在当前上下文
 *     • single.onPass/onBad：进入 stage 内下一个 node（没有下一个则走 stage.onComplete）
 *     • group.next：留在 open 内
 *     • option.next：若 choice 由 open 的 timedEvent 弹出则回到 open；否则等同 single 的 continue
 *     • open.onComplete：进入 stage 内下一个 node（没有下一个则走 stage.onComplete）
 *     • stage.onTimeout/onComplete：进入 stages 数组里的下一个 stage（没有下一个则触发结局）
 * - "end" → 立刻进入结局判定
 * - 其他字符串 → 优先匹配某个已存在的 stage id；也可以匹配 ending id，直接进入该结局
 */
export type TransitionTarget = string;

/** 单一节点：只有唯一正确答案，答对才推进 */
export interface SingleNode {
  type: 'single';
  /** 唯一 ID，用于结局条件判断 */
  id: string;
  /** NPC 先说的提示语（可选） */
  prompt?: MessageSequence;
  mode: 'any' | 'keyword' | 'contains';
  keywords?: string[];
  /** 答错时追加的系统消息，留空则不显示 */
  errorHint?: string;
  /** 答对后 NPC 的回复（可选） */
  successResponse?: MessageSequence;
  /** 答对后的跳转目标，默认 "continue" */
  onPass?: TransitionTarget;
  /**
   * 禁忌词：命中后立即记录结果为 'bad'，播放 badResponse，然后执行 onBad 跳转。
   * 优先于普通匹配逻辑检查，但低于 badExcludeKeywords。
   */
  badKeywords?: string[];
  badKeywordMode?: 'keyword' | 'contains';
  /**
   * 排除词：输入命中此列表时，跳过禁忌词检查，走正常匹配逻辑。
   * 使用 contains 模式匹配，优先于 badKeywords。
   */
  badExcludeKeywords?: string[];
  /** 命中禁忌词后播放的消息序列 */
  badResponse?: MessageSequence;
  /** 命中禁忌词后的跳转目标，默认 "end" */
  onBad?: TransitionTarget;
}

/** 话题组：开放节点内的关键词→回复映射 */
export interface TopicGroup {
  id: string;
  mode: 'keyword' | 'contains';
  keywords: string[];
  /** 多条 NPC 消息，逐条播放 */
  responses: MessageSequence;
  /** 是否可重复触发，默认 false */
  repeatable?: boolean;
  /** 回复播完后的跳转目标，默认 "continue"（留在 open 内） */
  next?: TransitionTarget;
  /**
   * 仅用于结局判定的 outcome 记录。
   * 和 next 解耦：想跳 stage 用 next，想让后续结局条件能引用此选择再加 recordOutcome。
   */
  recordOutcome?: { id: string; outcome: SingleOutcome };
}

/** open 节点内的定时事件：在节点激活后第 at 秒触发 choice 节点 */
export interface TimedEvent {
  /** 从 open 节点激活时起，经过多少秒触发，单位秒 */
  at: number;
  /** 触发的 choice 节点 */
  choice: ChoiceNode;
}

/** choice 节点中每个选项的配置 */
export interface ChoiceOption {
  mode: 'keyword' | 'contains';
  keywords: string[];
  /** 匹配后 NPC 的回复序列 */
  response?: MessageSequence;
  /** 回复播完后的跳转目标，默认 "continue" */
  next?: TransitionTarget;
  /**
   * 仅用于结局判定的 outcome 记录。
   * 和 next 解耦：想跳 stage 用 next，想让后续结局条件能引用此选择再加 recordOutcome。
   */
  recordOutcome?: { id: string; outcome: SingleOutcome };
}

/** 选择节点：NPC 提问，玩家从文本选项中触发一条分支 */
export interface ChoiceNode {
  type: 'choice';
  /** NPC 的提问序列 */
  prompt?: MessageSequence;
  options: ChoiceOption[];
  /** 输入不匹配任何选项时的 NPC 回复 */
  defaultResponse?: MessageSequence;
  /**
   * choice 自身计时（秒）。
   * 计时从 prompt 播放完毕、输入框可用时开始；省略则不启用节点级超时。
   */
  duration?: number;
  /** choice 自身计时到期后的回复序列 */
  timeoutResponse?: MessageSequence;
  /** choice 自身计时到期后的跳转目标，默认 "continue" */
  onTimeout?: TransitionTarget;
  /** choice 超时后记录的 outcome，用于结局条件判断 */
  timeoutOutcome?: { id: string; outcome: SingleOutcome };
}

/** 开放节点：玩家可自由探索多个话题 */
export interface OpenNode {
  type: 'open';
  /** 节点激活时自动播放的消息序列 */
  prompt?: MessageSequence;
  /**
   * 节点自身计时（秒）。
   * - 省略：仅当本节点是 stage 的最后一个 node 时合法，此时到期由 stage 计时器统一处理。
   * - 填写：若大于 stage 剩余时长，会被 stage 剩余时长截断。
   */
  duration?: number;
  /** 无关键词匹配时 NPC 的默认回复 */
  defaultResponse?: MessageSequence;
  groups: TopicGroup[];
  /** 在 open 节点运行期间定时插入的事件 */
  timedEvents?: TimedEvent[];
  /** open 自身计时到期后的跳转目标，默认 "continue" */
  onComplete?: TransitionTarget;
}

export type StageNode = SingleNode | OpenNode | ChoiceNode;

/** 阶段配置 */
export interface StageConfig {
  id: string;
  /** 阶段时长（秒），> 0，必填 */
  duration: number;
  /** 阶段开始时自动播放的消息序列 */
  intro?: IntroNode[];
  /** 本阶段内按顺序执行的交互节点 */
  nodes: StageNode[];
  /** 阶段计时到期时的跳转目标，默认 "continue" */
  onTimeout?: TransitionTarget;
  /** 所有 nodes 正常完成时的跳转目标，默认 "continue" */
  onComplete?: TransitionTarget;
}

// ============================================================
//  结局系统类型
// ============================================================

/** 结局触发条件 */
export interface EndingCondition {
  /** 要求通过（outcome = 'pass'）的 id 列表 */
  requiredPasses?: string[];
  /** 要求失败（outcome = 'fail'）的 id 列表 */
  requiredFails?: string[];
  /** 要求触发禁忌词（outcome = 'bad'）的 id 列表 */
  requiredBads?: string[];
  /** 只要 singleOutcomes 里存在任何 'bad' 记录就命中 */
  anyBad?: boolean;
  /** 兜底结局（当前面的结局均不匹配时触发） */
  default?: boolean;
}

/** 结局提示配置。运行时会渲染为聊天区内的结局卡片。 */
export interface EndingModal {
  title: string;
  body: string;
  buttonText?: string;
  /** 点击按钮后的跳转 URL，不填则只完成当前卡片操作 */
  redirectUrl?: string;
}

/** 结局配置 */
export interface EndingConfig {
  id: string;
  condition: EndingCondition;
  /** 结局触发前播放的消息序列 */
  intro?: IntroNode[];
  modal?: EndingModal;
}

// ============================================================
//  顶层对话配置
// ============================================================

/** 分阶段对话的完整配置 */
export interface StageDialogConfig {
  title?: string;
  contact: ContactConfig;
  playerAvatar?: string;
  friendAdd?: FriendAddConfig;
  /**
   * 全局共享的 bad 过场消息序列。节点触发 bad outcome 时，
   * 如果节点自身没有 badResponse / option.response，则回落到此序列。
   */
  badSequence?: MessageSequence;
  /** id 以 bad-end- 开头且没有自定义 modal 的结局，会回落使用此结局卡片配置 */
  defaultBadEndingModal?: EndingModal;
  stages: StageConfig[];
  endings?: EndingConfig[];
}
