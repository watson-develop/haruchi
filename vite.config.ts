/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/haruchi/',
  plugins: [
    VitePWA({
      // 자동 새로고침 금지. 스프린트 도중 리로드되면 세션이 날아간다.
      registerType: 'prompt',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: '하루치',
        short_name: '하루치',
        description: '매일 정해진 분량의 산수 연습',
        lang: 'ko',
        start_url: '/haruchi/',
        scope: '/haruchi/',
        display: 'standalone',
        orientation: 'portrait',
        // SEED bg-layer-basement(light)의 실값. manifest는 CSS 변수를 읽지 못해 복제가
        // 불가피하다 — app.css의 body 배경 토큰이 바뀌면 여기도 함께 갱신할 것.
        background_color: '#f3f4f5',
        theme_color: '#f3f4f5',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test-setup.ts'],
  },
})
