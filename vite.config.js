import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Base path: local dev uses '/', GitHub Actions sets BASE_PATH=/<repo>/ for Pages builds.
const base = process.env.BASE_PATH || '/'

export default defineConfig({
  plugins: [react()],
  base,
})
