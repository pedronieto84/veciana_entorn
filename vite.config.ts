import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import 'dotenv/config';
export default defineConfig({ root: 'web', plugins: [react()],
	server: { port: Number(process.env.WEB_PORT || 8088), strictPort: true, proxy: { '/api': { target: `http://127.0.0.1:${process.env.APP_PORT || 8080}`, changeOrigin: false } } },
	build: { outDir: '../dist/web', emptyOutDir: true } });