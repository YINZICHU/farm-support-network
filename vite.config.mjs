import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { projectConfig, validateProjectConfig } from './src/farm-support/project-config.js';

export function projectTitlePlugin(project = projectConfig) {
  const configured = validateProjectConfig(project);
  const name = configured.projectName.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return { name: 'network-project-title', transformIndexHtml: html => html.replace(/<title>[\s\S]*?<\/title>/, () => `<title>负责人工作台 | ${name}</title>`) };
}

export default defineConfig({
  plugins: [react(), projectTitlePlugin()],
  build: { outDir: 'dist/client', sourcemap: false },
  server: { host: '127.0.0.1', port: 4178, strictPort: true },
  preview: { host: '127.0.0.1', port: 4179, strictPort: true },
});
