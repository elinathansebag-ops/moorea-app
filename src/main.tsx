import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { VersionChecker } from './VersionChecker'
import { ErrorBoundary } from './ErrorBoundary'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <VersionChecker />
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
