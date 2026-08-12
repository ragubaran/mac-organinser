/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // Important for electron
  test: {
    include: ['src/**/*.test.tsx', 'src-main/**/*.test.js'],
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['src-main/**/*.js'],
      exclude: ['src-main/**/*.test.js'],
      all: true
    }
  },
})
