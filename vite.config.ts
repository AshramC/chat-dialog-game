import { defineConfig } from 'vite';

export default defineConfig({
  // 部署到 GitHub Pages 时，设置你的仓库名
  // base: '/your-repo-name/',
  base: './',
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
  server: {
    port: 3000,
    open: true,
  },
});
