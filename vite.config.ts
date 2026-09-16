import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The phone UI is React + even-toolkit (founder ruling S276·2997); the glasses
// engine underneath it stays framework-free, exactly as BLUEPRINT.md requires.
export default defineConfig({
  plugins: [react(), tailwindcss()],
})
