import './style.css';
import { StagedDialogEngine } from './engine.ts';
import type { StageDialogConfig } from './types.ts';

const DIALOGUE_DIR = './dialogues';
const DIALOGUE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

interface BuiltinDialogueMeta {
  id: string;
  title: string;
  description: string;
  badge: string;
}

const BUILTIN_DIALOGUES: BuiltinDialogueMeta[] = [
  {
    id: 'demo-night-shift',
    title: '夜巡值班示例',
    description: '演示 single、open、choice、image、ending 等核心节点。',
    badge: '公开示例',
  },
];

async function boot(): Promise<void> {
  const loading = document.getElementById('loadingScreen');
  const params = new URLSearchParams(window.location.search);
  const dialogueId = params.get('d')?.trim() ?? '';

  try {
    if (!dialogueId) {
      loading?.remove();
      showLauncher();
      return;
    }

    if (!DIALOGUE_ID_PATTERN.test(dialogueId)) {
      throw new Error('对话 ID 只允许字母、数字、短横线和下划线。');
    }

    const url = `${DIALOGUE_DIR}/${dialogueId}.json`;
    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(`无法加载对话脚本: ${dialogueId}.json (${res.status})`);
    }

    const config = await res.json() as StageDialogConfig;

    loading?.classList.add('hidden');
    window.setTimeout(() => loading?.remove(), 300);

    new StagedDialogEngine(config, { dialogueId });
  } catch (err) {
    loading?.remove();
    showLauncher({
      attemptedId: dialogueId || 'unknown',
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

function showLauncher(error?: { attemptedId: string; message: string }): void {
  document.title = 'WeChat Dialog';
  document.querySelector('.phone-frame')?.remove();
  document.getElementById('hintToast')?.remove();

  const screen = document.createElement('main');
  screen.className = 'dialogue-launcher';

  const header = document.createElement('section');
  header.className = 'launcher-shell';

  const eyebrow = document.createElement('div');
  eyebrow.className = 'launcher-eyebrow';
  eyebrow.textContent = 'Open Source Demo';
  header.appendChild(eyebrow);

  const title = document.createElement('h1');
  title.className = 'launcher-title';
  title.textContent = 'WeChat Dialog';
  header.appendChild(title);

  const desc = document.createElement('p');
  desc.className = 'launcher-description';
  desc.textContent = '一个微信风格的分阶段互动对话引擎。默认首页会展示示例剧本，你也可以通过 URL 参数直接加载自己的 JSON。';
  header.appendChild(desc);

  if (error) {
    const note = document.createElement('div');
    note.className = 'launcher-note is-error';
    note.innerHTML = `找不到对话 <strong>${escapeHtml(error.attemptedId)}</strong>。<br><small>${escapeHtml(error.message)}</small>`;
    header.appendChild(note);
  } else {
    const note = document.createElement('div');
    note.className = 'launcher-note';
    note.textContent = '把剧本放进 public/dialogues/ 后，就能通过 ?d=<id> 访问。';
    header.appendChild(note);
  }

  const grid = document.createElement('div');
  grid.className = 'launcher-grid';

  BUILTIN_DIALOGUES.forEach((dialogue) => {
    const card = document.createElement('article');
    card.className = 'launcher-card';

    const badge = document.createElement('span');
    badge.className = 'launcher-pill';
    badge.textContent = dialogue.badge;
    card.appendChild(badge);

    const cardTitle = document.createElement('h2');
    cardTitle.className = 'launcher-card-title';
    cardTitle.textContent = dialogue.title;
    card.appendChild(cardTitle);

    const cardDesc = document.createElement('p');
    cardDesc.className = 'launcher-card-description';
    cardDesc.textContent = dialogue.description;
    card.appendChild(cardDesc);

    const meta = document.createElement('code');
    meta.className = 'launcher-card-meta';
    meta.textContent = `?d=${dialogue.id}`;
    card.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'launcher-actions';

    const openLink = document.createElement('a');
    openLink.className = 'launcher-link';
    openLink.href = buildDialogueHref(dialogue.id);
    openLink.textContent = '打开示例';
    actions.appendChild(openLink);

    card.appendChild(actions);
    grid.appendChild(card);
  });

  header.appendChild(grid);

  const tips = document.createElement('section');
  tips.className = 'launcher-shell launcher-shell-secondary';
  tips.innerHTML = `
    <h2 class="launcher-section-title">快速开始</h2>
    <div class="launcher-steps">
      <code>npm install</code>
      <code>npm run dev</code>
      <code>http://localhost:3000/?d=demo-night-shift</code>
    </div>
  `;

  screen.appendChild(header);
  screen.appendChild(tips);
  document.body.appendChild(screen);
}

function buildDialogueHref(id: string): string {
  return `${window.location.pathname}?d=${encodeURIComponent(id)}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

document.addEventListener('DOMContentLoaded', boot);
