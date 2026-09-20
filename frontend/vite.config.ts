import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// SPA. base './' 로 Amplify 하위 경로/정적 호스팅 모두 대응.
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    // jsdom 금지(명세) → node 환경에서 순수 로직만 테스트
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
  },
});
