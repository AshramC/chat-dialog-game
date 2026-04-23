# Dialogue Types

本文档描述当前 `src/types.ts` 和 `src/engine.ts` 实际支持的剧本格式。剧本文件是一个 `StageDialogConfig` JSON，放在 `public/dialogues/` 下，并通过 `/?d=<id>` 加载。

## 顶层配置

```json
{
  "title": "夜巡值班示例",
  "contact": {
    "name": "值班班长",
    "avatar": "assets/demo-contact.svg"
  },
  "playerAvatar": "assets/demo-player.svg",
  "friendAdd": {
    "enabled": true,
    "time": "下午 8:00",
    "greeting": "你好",
    "customText": "你已加入临时值班频道，以上是你的第一条消息。"
  },
  "badSequence": [],
  "defaultBadEndingModal": {
    "title": "逃脱失败",
    "body": "结局说明",
    "buttonText": "重新开始",
    "redirectUrl": "?d=demo-night-shift"
  },
  "stages": [],
  "endings": []
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `title` | `string` | 否 | 页面标题；不填时使用 `contact.name` |
| `contact.name` | `string` | 是 | 顶部显示的联系人名 |
| `contact.avatar` | `string` | 否 | NPC 头像路径 |
| `playerAvatar` | `string` | 否 | 玩家头像路径 |
| `friendAdd` | `FriendAddConfig` | 否 | 初始添加好友提示 |
| `badSequence` | `MessageSequence` | 否 | 全局 bad 过场；节点没写自己的 badResponse 时使用 |
| `defaultBadEndingModal` | `EndingModal` | 否 | `bad-end-` 开头结局的默认卡片 |
| `stages` | `StageConfig[]` | 是 | 剧情阶段 |
| `endings` | `EndingConfig[]` | 否 | 结局列表 |

## 消息序列

`MessageSequence` 是一组按顺序播放的消息节点，用于：

- `stage.intro`
- `single.prompt`
- `single.successResponse`
- `single.badResponse`
- `open.prompt`
- `open.defaultResponse`
- `group.responses`
- `choice.prompt`
- `choice.defaultResponse`
- `choice.timeoutResponse`
- `option.response`
- `ending.intro`
- `badSequence`

消息节点播放时，默认 NPC 类消息等待 2000ms 后出现。可用 `delay`、`pause`、`typingDuration` 调整节奏。

### 延迟字段

| 字段 | 说明 |
| --- | --- |
| `delay` | 消息出现前总等待时间，单位 ms |
| `typingDuration` | 顶部“对方正在输入...”显示时间，单位 ms |
| `pause` | 先静默等待，再显示输入状态；优先于 `delay` |

如果写了 `pause`，总等待约为：

```text
pause + typingDuration
```

如果没写 `pause`，总等待由 `delay` 控制，`typingDuration` 会占用其中一段时间。

## 消息节点

### npc

NPC 文本消息。

```json
{
  "type": "npc",
  "text": "在吗？",
  "pause": 1000,
  "typingDuration": 1200
}
```

| 字段 | 类型 | 必填 |
| --- | --- | --- |
| `type` | `"npc"` | 是 |
| `text` | `string` | 是 |
| `pause` / `delay` / `typingDuration` | `number` | 否 |

### time

时间戳。

```json
{ "type": "time", "text": "下午 8:00" }
```

```json
{ "type": "time", "useCurrentTime": true }
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `type` | `"time"` | 是 |  |
| `text` | `string` | 否 | 指定显示文本 |
| `useCurrentTime` | `boolean` | 否 | 使用当前本地时间；不写 `text` 时也会使用当前时间 |

### system

系统灰字消息。

```json
{ "type": "system", "text": "对方已开启消息免打扰" }
```

### system-notice-card

系统须知卡片。常用于游戏开始前说明。

```json
{
  "type": "system-notice-card",
  "title": "游戏须知",
  "description": "开始前请阅读",
  "items": ["回复任意内容开始游戏"],
  "footer": "祝你好运",
  "showBeforeStart": true
}
```

特殊规则：第一个 stage 的 `intro` 开头如果连续出现 `system-notice-card`，且 `showBeforeStart` 不是 `false`，它们会在玩家第一次输入前立即显示。之后第一次输入会正式开始游戏。

### npc-image

NPC 图片消息。点击后全屏预览。

```json
{
  "type": "npc-image",
  "src": "assets/demo-panel.svg"
}
```

### system-image

居中的系统图片卡片。点击后全屏预览。

```json
{
  "type": "system-image",
  "src": "assets/demo-map.svg",
  "alt": "平面图"
}
```

### npc-voice

NPC 语音消息。点击语音气泡播放音频；如果没有 `src`，只模拟播放动画。

```json
{
  "type": "npc-voice",
  "src": "assets/voice.mp3",
  "duration": 5
}
```

| 字段 | 类型 | 必填 |
| --- | --- | --- |
| `duration` | `number` | 是 |
| `src` | `string` | 否 |

### npc-video

NPC 视频消息。点击后横屏全屏播放，播放期间会暂停阶段计时器。

本地视频：

```json
{
  "type": "npc-video",
  "src": "assets/video.mp4",
  "poster": "assets/poster.jpg",
  "duration": "0:30"
}
```

iframe 视频：

```json
{
  "type": "npc-video",
  "iframe": "//player.bilibili.com/player.html?bvid=BVxxxx",
  "duration": "2:30"
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `src` | `string` | 否 | 本地视频地址 |
| `iframe` | `string` | 否 | iframe 播放地址 |
| `poster` | `string` | 否 | 封面图 |
| `duration` | `string` | 否 | 当前主要作为配置字段保留 |
| `advanceOnClose` | `boolean` | 否 | 兼容字段；关闭视频后按当前 stage 的 `onComplete` 推进 |

`src` 和 `iframe` 至少应提供一个。

### npc-embed

网页或小程序卡片。点击后用全屏 iframe 打开。

普通链接卡片：

```json
{
  "type": "npc-embed",
  "url": "https://example.com/article",
  "title": "标题",
  "description": "摘要",
  "cover": "assets/cover.jpg",
  "articleSource": "来源"
}
```

小程序卡片：

```json
{
  "type": "npc-embed",
  "url": "miniprogram/page.html",
  "title": "小程序标题",
  "cover": "assets/cover.jpg",
  "appName": "小程序名",
  "appIcon": "assets/icon.png"
}
```

被嵌入页面可以通过 `postMessage` 关闭自身：

```js
window.parent.postMessage({ type: 'chat-dialog:close-embed' }, '*');
```

### ending-card

聊天区结局卡片。通常不直接写在剧本消息里，而是由 `ending.modal` 或 `defaultBadEndingModal` 自动生成。

```json
{
  "type": "ending-card",
  "title": "结局",
  "body": "你离开了这里。",
  "restartButtonText": "重新开始",
  "restartUrl": "?d=demo-night-shift"
}
```

如果没有 `restartUrl`：

- 没有 `restartButtonText` 时，按钮会清除存档并刷新当前对话。
- 有 `restartButtonText` 时，点击后按钮显示“已完成”，不会跳转。

## Stage

阶段是剧情的基本计时单位。

```json
{
  "id": "stage-1",
  "duration": 120,
  "intro": [],
  "nodes": [],
  "onTimeout": "stage-2",
  "onComplete": "continue"
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | `string` | 是 | 阶段 id |
| `duration` | `number` | 是 | 阶段时长，单位秒 |
| `intro` | `MessageSequence` | 否 | 阶段开始时播放 |
| `nodes` | `StageNode[]` | 是 | 本阶段交互节点 |
| `onTimeout` | `TransitionTarget` | 否 | 阶段超时跳转，默认 `continue` |
| `onComplete` | `TransitionTarget` | 否 | 本阶段所有节点完成后的跳转，默认 `continue` |

阶段超时时：

- 当前 active 的 `single` 会记录为 `fail`。
- 本阶段后续尚未到达的 `single` 也会记录为 `fail`。
- 播放中的消息会被中断。
- 然后执行 `stage.onTimeout`。

## TransitionTarget

跳转目标用于 `onTimeout`、`onComplete`、`onPass`、`onBad`、`next` 等字段。

| 值 | 含义 |
| --- | --- |
| `"continue"` | 按当前上下文继续 |
| `"end"` | 进入结局条件判定 |
| stage id | 跳到指定阶段 |
| ending id | 直接进入指定结局 |

`continue` 的具体含义取决于上下文：

| 上下文 | `continue` 行为 |
| --- | --- |
| `single.onPass` / `single.onBad` | 进入当前 stage 的下一个 node |
| `open.onComplete` | 进入当前 stage 的下一个 node |
| `group.next` | 回到当前 open 节点继续探索 |
| 独立 `choice.option.next` | 进入当前 stage 的下一个 node |
| open 的 `timedEvents.choice.option.next` | 回到 open 节点 |
| `stage.onTimeout` / `stage.onComplete` | 进入下一个 stage；没有下一个则判定结局 |

## 输入匹配

支持三种匹配模式：

| mode | 说明 |
| --- | --- |
| `any` | 任意非空输入都通过 |
| `keyword` | 归一化后必须等于某个关键词 |
| `contains` | 归一化后输入中包含某个关键词 |

归一化会做：

- Unicode NFKC normalize
- 转小写
- 合并空白
- 去除常见中英文标点
- trim

例如 `“去 三 楼！”` 会被简化后再参与匹配。

## single

单次判定节点。常用于确认玩家输入了某个答案。

```json
{
  "type": "single",
  "id": "confirm-visible",
  "prompt": [
    { "type": "npc", "text": "能看到我的消息吗？" }
  ],
  "mode": "any",
  "keywords": [],
  "errorHint": "信息发送失败，请尝试使用不同的词语重试。",
  "successResponse": [
    { "type": "npc", "text": "太好了！" }
  ],
  "onPass": "continue",
  "badKeywords": ["危险词"],
  "badKeywordMode": "contains",
  "badExcludeKeywords": ["排除词"],
  "badResponse": [],
  "onBad": "end"
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | `string` | 是 | outcome id |
| `prompt` | `MessageSequence` | 否 | 节点开始时播放 |
| `mode` | `any \| keyword \| contains` | 是 | 匹配模式 |
| `keywords` | `string[]` | 否 | 匹配关键词 |
| `errorHint` | `string` | 否 | 输入不匹配时显示的系统提示 |
| `successResponse` | `MessageSequence` | 否 | 匹配成功后播放 |
| `onPass` | `TransitionTarget` | 否 | 成功跳转，默认 `continue` |
| `badKeywords` | `string[]` | 否 | 禁忌词 |
| `badKeywordMode` | `keyword \| contains` | 否 | 禁忌词匹配，默认 `contains` |
| `badExcludeKeywords` | `string[]` | 否 | 命中后跳过禁忌词检查 |
| `badResponse` | `MessageSequence` | 否 | 命中禁忌词后播放 |
| `onBad` | `TransitionTarget` | 否 | bad 跳转，默认 `end` |

成功时记录：

```text
singleOutcomes[id] = "pass"
```

阶段超时时，未完成的 single 会记录：

```text
singleOutcomes[id] = "fail"
```

命中禁忌词时记录：

```text
singleOutcomes[id] = "bad"
```

输入不匹配时，会显示玩家消息为发送失败状态，不推进节点。

## open

开放探索节点。玩家可以输入多个关键词触发不同话题。

```json
{
  "type": "open",
  "prompt": [
    { "type": "npc", "text": "你想问什么？" }
  ],
  "duration": 60,
  "defaultResponse": [
    { "type": "npc", "text": "我不太明白。" }
  ],
  "groups": [
    {
      "id": "ask-door",
      "mode": "contains",
      "keywords": ["门"],
      "responses": [
        { "type": "npc", "text": "门打不开。" }
      ],
      "repeatable": false,
      "recordOutcome": {
        "id": "asked-door",
        "outcome": "pass"
      },
      "next": "continue"
    }
  ],
  "timedEvents": [],
  "onComplete": "continue"
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `prompt` | `MessageSequence` | 否 | 节点开始时播放 |
| `duration` | `number` | 否 | open 自身时长，单位秒 |
| `defaultResponse` | `MessageSequence` | 否 | 无匹配时播放 |
| `groups` | `TopicGroup[]` | 是 | 话题组 |
| `timedEvents` | `TimedEvent[]` | 否 | 定时弹出的 choice |
| `onComplete` | `TransitionTarget` | 否 | open 到期后的跳转，默认 `continue` |

`duration` 规则：

- 如果 open 是当前 stage 最后一个 node，可以省略 `duration`，由 stage 计时器控制结束。
- 如果 open 不是最后一个 node，应填写 `duration`。
- open 的有效截止时间不会超过 stage 剩余时间。

### TopicGroup

```json
{
  "id": "look-notice",
  "mode": "contains",
  "keywords": ["公告", "通知"],
  "responses": [],
  "repeatable": false,
  "recordOutcome": {
    "id": "look-notice",
    "outcome": "pass"
  },
  "next": "continue"
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | `string` | 是 | 话题 id；用于防重复 |
| `mode` | `keyword \| contains` | 是 | 匹配模式 |
| `keywords` | `string[]` | 是 | 关键词 |
| `responses` | `MessageSequence` | 是 | 命中后播放 |
| `repeatable` | `boolean` | 否 | 是否可重复触发，默认 false |
| `recordOutcome` | `{ id, outcome }` | 否 | 额外记录 outcome |
| `next` | `TransitionTarget` | 否 | 回复后跳转，默认 `continue` |

无匹配时：

- 有 `defaultResponse`：播放它。
- 没有 `defaultResponse`：显示系统提示“信息发送失败，请尝试使用不同的词语重试。”

## choice

选择节点。玩家用文本触发选项。

```json
{
  "type": "choice",
  "prompt": [
    { "type": "npc", "text": "我要不要进去？" }
  ],
  "options": [
    {
      "mode": "contains",
      "keywords": ["进去", "进"],
      "response": [
        { "type": "npc", "text": "好，我进去看看。" }
      ],
      "recordOutcome": {
        "id": "enter-room",
        "outcome": "pass"
      },
      "next": "stage-2"
    }
  ],
  "defaultResponse": [
    { "type": "npc", "text": "你说清楚一点。" }
  ],
  "duration": 20,
  "timeoutResponse": [
    { "type": "npc", "text": "你还在吗？" }
  ],
  "timeoutOutcome": {
    "id": "choice-timeout",
    "outcome": "fail"
  },
  "onTimeout": "end"
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `prompt` | `MessageSequence` | 否 | 选择前播放 |
| `options` | `ChoiceOption[]` | 是 | 选项 |
| `defaultResponse` | `MessageSequence` | 否 | 输入不匹配时播放 |
| `duration` | `number` | 否 | choice 自身时长，单位秒 |
| `timeoutResponse` | `MessageSequence` | 否 | choice 超时后播放 |
| `timeoutOutcome` | `{ id, outcome }` | 否 | 超时后记录 outcome |
| `onTimeout` | `TransitionTarget` | 否 | 超时跳转，默认 `continue` |

choice 的计时从 `prompt` 播放完成、输入框可用时开始。有效截止时间不会超过当前 stage 截止时间。

### ChoiceOption

```json
{
  "mode": "contains",
  "keywords": ["躲"],
  "response": [
    { "type": "npc", "text": "我先躲起来。" }
  ],
  "recordOutcome": {
    "id": "hide",
    "outcome": "pass"
  },
  "next": "continue"
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `mode` | `keyword \| contains` | 是 | 匹配模式 |
| `keywords` | `string[]` | 是 | 关键词 |
| `response` | `MessageSequence` | 否 | 命中后播放 |
| `recordOutcome` | `{ id, outcome }` | 否 | 额外记录 outcome |
| `next` | `TransitionTarget` | 否 | 选项跳转，默认 `continue` |

## timedEvents

`open` 节点可以在运行中定时弹出一个 `choice`。

```json
{
  "type": "open",
  "groups": [],
  "timedEvents": [
    {
      "at": 20,
      "choice": {
        "type": "choice",
        "prompt": [
          { "type": "npc", "text": "我听到声音了，要过去吗？" }
        ],
        "options": []
      }
    }
  ]
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `at` | `number` | 是 | 从 open 激活开始算，第几秒触发 |
| `choice` | `ChoiceNode` | 是 | 要插入的 choice |

如果 timed event 的 choice 使用 `next: "continue"`，答完后会回到原 open 节点继续探索。

## outcome

结局系统只关心 `singleOutcomes` 里的结果。结果值有三种：

```text
pass
fail
bad
```

会写入 outcome 的来源：

- `single` 成功：`id -> pass`
- `single` 被阶段超时：`id -> fail`
- `single` 命中禁忌词：`id -> bad`
- `TopicGroup.recordOutcome`
- `ChoiceOption.recordOutcome`
- `ChoiceNode.timeoutOutcome`

## endings

结局列表按顺序匹配，命中第一个就使用。`default: true` 是兜底条件，所以应放在最后。

```json
{
  "id": "good-end-escape",
  "condition": {
    "requiredPasses": ["find-key"],
    "requiredFails": [],
    "requiredBads": [],
    "anyBad": false
  },
  "intro": [
    { "type": "npc", "text": "我们出去了。" }
  ],
  "modal": {
    "title": "逃出生天",
    "body": "你完成了调查。",
    "buttonText": "重新开始",
    "redirectUrl": "?d=demo-night-shift"
  }
}
```

### EndingCondition

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `requiredPasses` | `string[]` | 列出的 id 必须是 `pass` |
| `requiredFails` | `string[]` | 列出的 id 必须是 `fail` |
| `requiredBads` | `string[]` | 列出的 id 必须是 `bad` |
| `anyBad` | `boolean` | 任意 outcome 是 `bad` 即命中 |
| `default` | `boolean` | 兜底结局 |

### EndingModal

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `title` | `string` | 是 | 卡片标题 |
| `body` | `string` | 是 | 卡片正文 |
| `buttonText` | `string` | 否 | 按钮文字 |
| `redirectUrl` | `string` | 否 | 点击按钮跳转地址 |

如果结局 id 以 `bad-end-` 开头，且结局没有自己的 `modal`，引擎会使用顶层 `defaultBadEndingModal`。

## 存档恢复

引擎会把以下信息保存到 `localStorage`：

- 剧本 id
- 剧本配置签名
- 当前 stage 和 node
- stage/open/choice 计时信息
- 已触发的 open group
- fired timed events
- pending timed-event choice
- outcome 记录
- 已渲染聊天记录
- 是否等待首次输入
- 是否已经结束

恢复条件：

- 存档版本匹配
- URL 中的对话 id 匹配
- 剧本 JSON 内容签名匹配
- transcript 结构有效

修改 JSON 后，旧存档会自动失效。

## 配置校验

启动时会通过 `console.warn` 报告部分配置问题，但不会阻止运行：

- 重复 stage id
- 跳转目标不存在
- open 不是 stage 最后一个 node 且没有 `duration`
- open/choice 的 duration 超过 stage duration
- timed event 的 `at` 超出 open/stage 有效时长

未知跳转目标运行时会进入结局判定兜底。
