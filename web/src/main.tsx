import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import 'virtual:uno.css'
import './style.css'
import App from './App'
import './theme'
// The independent domain also serves the prefixed application at its root.
// Canonicalize in the browser: the gateway strips /news before proxying, so a
// server redirect based on the upstream path would loop.
const base = import.meta.env.BASE_URL.replace(/\/$/, '')
if (base && location.pathname !== base && !location.pathname.startsWith(base + '/')) {
  history.replaceState(
    history.state,
    '',
    `${base}${location.pathname}${location.search}${location.hash}`,
  )
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={base || '/'}>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
