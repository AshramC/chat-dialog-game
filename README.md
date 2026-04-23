# Chat Dialog Game

一个微信聊天风格的互动剧情引擎。你可以用 JSON 剧本组织聊天流程、玩家回复、分支选择，以及图片语音视频等内容。

这个开源副本默认附带一个独立示例剧本：

```text
public/dialogues/demo-night-shift.json
```

直接访问首页会显示示例入口；也可以通过参数直接打开：

```text
http://localhost:3000/?d=demo-night-shift
```

## 特性

- 微信聊天界面风格的文本互动
- 按剧情阶段推进流程，可控制每一段对话的时长和跳转
- 支持单轮回答、自由追问、分支抉择三种常见互动方式
- 支持开场须知、图片、语音、视频、内嵌网页、结局卡片等富媒体消息
- 基于 `localStorage` 的进度恢复
- 纯前端部署，可直接发布到静态托管平台

## 互动方式说明

这个项目里，一段剧情通常会拆成多个阶段；每个阶段里再放具体的互动方式。下面这三类是最常用的推进手段：

| 互动方式 | 适合场景 | 运行方式 |
| --- | --- | --- |
| 单轮回答（`single`） | 单次问答、口令校验、关键确认 | 玩家输入一次答案，命中条件后推进；超时会记为失败；命中禁忌词会立刻走坏结果分支 |
| 自由追问（`open`） | 自由探索、追问线索、多轮聊天 | 玩家可以围绕同一话题连续提问，命中不同关键词触发不同回复；到时后会自动收束 |
| 分支抉择（`choice`） | 明确分支、限时抉择、二选一/多选一文本选项 | 玩家输入命中某个选项后进入对应分支；也可以配置倒计时和超时结果 |

### 单轮回答（`single`）

- 用于“这一轮回复是否答对”的场景，例如确认在线、输入关键词、回答暗号。
- 常见结果有三种：
  - `pass`：输入命中条件，播放 `successResponse`，然后执行 `onPass`
  - `fail`：节点没完成但 stage 超时，系统会把该节点记为失败
  - `bad`：输入命中 `badKeywords`，播放 `badResponse`，再执行 `onBad`
- 这类节点最适合放在关键剧情门槛上，因为它的结果会直接影响后续剧情和结局判定。

### 自由追问（`open`）

- 用于“玩家可以围绕同一情境连续追问”的节点，例如盘问 NPC、检查环境、逐步挖线索。
- 你可以在里面配置多个话题分组，每个分组对应一组关键词和回复。
- 命中某个 group 后，默认会回到当前 `open` 节点继续探索；也可以用 `next` 直接跳到别的 stage 或结局。
- 如果配置了 `timedEvents`，引擎会在自由追问进行期间按秒触发额外事件，常见用法是在聊天过程中突然弹出一个限时选择。

### 分支抉择（`choice`）

- 用于“玩家必须在几个明确方向里选一个”的节点，例如“去还是不去”“信还是不信”。
- 每个选项都可以配置自己的关键词、回复和跳转目标。
- 当 `choice` 是独立节点时，选中选项后通常进入当前 stage 下一个节点；当它来自 `open.timedEvents` 时，默认会回到原来的 `open` 继续。
- 如果设置了 `duration`，倒计时结束后会播放 `timeoutResponse`，再执行 `onTimeout`，适合做限时决策和压力场景。

## 消息类型说明

README 里列出的这些消息类型，不只是“展示素材”，它们本身就是剧情表达的一部分：

| 消息类型 | 作用 | 运行表现 |
| --- | --- | --- |
| `system-notice-card` | 开场须知、规则说明、警告提示 | 如果它出现在第一个 stage 的 `intro` 开头，并且 `showBeforeStart` 不是 `false`，会在玩家首次输入前直接展示 |
| 图片消息 | 展示线索图、地图、聊天截图、证据 | `npc-image` 以聊天气泡形式出现，`system-image` 以居中卡片显示，点击后都可全屏预览 |
| 语音消息 | 模拟微信语音、增强临场感 | `npc-voice` 会以语音气泡展示；有 `src` 时播放真实音频，没有时也能模拟播放动画 |
| 视频消息 | 播放监控、录像、片段证据 | `npc-video` 点击后进入全屏播放，播放期间会暂停阶段计时器，避免玩家因看视频被动超时 |
| 内嵌网页 | 打开文章、伪网页、小程序页面 | `npc-embed` 会以卡片形式出现，点击后用全屏 iframe 打开；适合承载补充信息或假页面线索 |
| 结局卡片 | 呈现阶段性收束或正式结局 | `ending-card` 会在聊天区内显示结果说明、提示文案和重新开始按钮；也可由 `ending.modal` 自动生成 |

这些消息节点都可以出现在 `stage.intro`、节点回复序列、结局前过场里，因此它们不仅能“展示内容”，也能承担节奏切换、信息投放和结局呈现。

## 开发

```bash
npm install
npm run dev
npm run build
npm run preview
```

默认开发地址通常是 `http://localhost:3000/`。

## 快速开始

1. 启动开发服务器。
2. 打开首页，点击示例卡片。
3. 或者直接访问 `/?d=demo-night-shift`。
4. 修改 `public/dialogues/demo-night-shift.json`，观察剧情变化。

## 项目结构

```text
chat-dialog/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── src/
│   ├── main.ts
│   ├── engine.ts
│   ├── types.ts
│   └── style.css
└── public/
    ├── dialogues/
    │   └── demo-night-shift.json
    └── assets/
        ├── demo-contact.svg
        ├── demo-player.svg
        ├── demo-map.svg
        └── demo-panel.svg
```

## 运行方式

运行时会按下面的顺序工作：

1. `src/main.ts` 读取 URL 参数 `?d=<id>`。
2. 无参数时渲染示例入口页；有参数时请求 `./dialogues/<id>.json`。
3. JSON 作为 `StageDialogConfig` 交给 `StagedDialogEngine`。
4. 引擎根据玩家输入、节点跳转和倒计时推进剧情。
5. 运行状态保存到 `localStorage`，刷新页面后会尝试恢复。

## 新增剧本

把你的 JSON 文件放进：

```text
public/dialogues/<id>.json
```

然后通过下面的地址访问：

```text
/?d=<id>
```

例如：

```text
/?d=my-first-dialogue
```

资源路径以 `public/` 为根目录，例如：

```json
{
  "contact": {
    "avatar": "assets/demo-contact.svg"
  },
  "playerAvatar": "assets/demo-player.svg"
}
```

完整字段说明见 [DIALOGUE_TYPES.md](./DIALOGUE_TYPES.md)。

## 最小剧本示例

```json
{
  "title": "夜巡值班示例",
  "contact": {
    "name": "值班班长",
    "avatar": "assets/demo-contact.svg"
  },
  "playerAvatar": "assets/demo-player.svg",
  "stages": [
    {
      "id": "stage-1",
      "duration": 60,
      "intro": [
        { "type": "time", "useCurrentTime": true },
        { "type": "npc", "text": "值班频道有人吗？" }
      ],
      "nodes": [
        {
          "type": "single",
          "id": "confirm-online",
          "mode": "any",
          "successResponse": [
            { "type": "npc", "text": "收到，总算联系上了。" }
          ],
          "onPass": "end"
        }
      ]
    }
  ],
  "endings": [
    {
      "id": "ending-default",
      "condition": { "default": true },
      "modal": {
        "title": "结束",
        "body": "这是一个最小可运行示例。",
        "buttonText": "重新开始",
        "redirectUrl": "?d=demo-night-shift"
      }
    }
  ]
}
```

## 构建产物

```bash
npm run build
```

输出目录：

```text
dist/
```
