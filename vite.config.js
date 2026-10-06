import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Frontend web/ da, build public/ ga — server shu papkani tarqatadi.
// Dev rejimda /api so'rovlari Node serverga proksilanadi, shunda cookie
// bir xil origin'da qoladi va CORS kerak bo'lmaydi.
const API = `http://localhost:${process.env.PORT || 3000}`;

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: '../public', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { '/api': API, '/healthz': API },
  },
});
