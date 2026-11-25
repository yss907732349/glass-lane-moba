import { defineConfig } from 'vite';
export default defineConfig({ base: './', server: { port: 5175, proxy: { '/ws': { target: 'ws://127.0.0.1:4327', ws: true }, '/health': 'http://127.0.0.1:4327' } } });
