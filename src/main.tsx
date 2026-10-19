import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { MotionGlobalConfig } from 'motion/react'
import { router } from './router.tsx'
import './styles.css'

// Browser tests run on a fake clock that also freezes animation frames.
try {
  if (localStorage.getItem('stretch.noMotion'))
    MotionGlobalConfig.skipAnimations = true
} catch {
  // Storage unavailable: keep animations.
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register('/sw.js')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
