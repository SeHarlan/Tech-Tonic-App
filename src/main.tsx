import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/rajdhani/latin-300.css'
import '@fontsource/rajdhani/latin-400.css'
import '@fontsource/rajdhani/latin-500.css'
import '@fontsource/rajdhani/latin-600.css'
import '@fontsource/rajdhani/latin-700.css'
import '@fontsource/share-tech-mono/latin-400.css'
import './index.css'
import App from './App.tsx'
import { WalletProvider } from './providers/WalletProvider'

createRoot(document.getElementById('root')!).render(
  <WalletProvider>
    <StrictMode>
      <App />
    </StrictMode>
  </WalletProvider>,
)
