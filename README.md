# WeChat Dialog

微信风格的分阶段互动对话引擎。项目基于 Vite + TypeScript，运行时通过 URL 参数加载 `public/dialogues/` 下的 JSON 剧本。

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
- 按 stage 推进的分阶段流程
- `single`、`open`、`choice` 三类交互节点
- `system-notice-card`、图片、语音、视频、内嵌网页、结局卡片等消息类型
- 基于 `localStorage` 的进度恢复
- 纯前端部署，可直接发布到静态托管平台

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

## 开源整理建议

如果你打算把这个仓库作为公开项目发布，建议至少完成这些动作：

- 把示例剧本替换成你愿意公开分发的内容
- 把 `public/assets/` 换成你自制或可再分发素材
- 在发布前补充正式许可证文件
- 根据你的项目定位修改首页文案和 README

## 构建产物

```bash
npm run build
```

输出目录：

```text
dist/
```
