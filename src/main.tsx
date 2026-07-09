import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { VersionChecker } from './VersionChecker'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <VersionChecker />
    <App />
  </React.StrictMode>,
)
