import { createRoot } from 'react-dom/client'
import { App } from './App'

/** Replaces the hand-rolled initUI(). Same contract: build the phone screen,
 *  bind to engine state that already exists. */
export function initUI() {
  const el = document.getElementById('app')
  if (!el) return
  createRoot(el).render(<App />)
}
