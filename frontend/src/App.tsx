import { Component, type ReactNode } from 'react'
import { HashRouter, Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { EmptyState } from './components/ui'
import { StoreProvider } from './lib/store'
import Alerts from './pages/Alerts'
import Assistant from './pages/Assistant'
import Dashboard from './pages/Dashboard'
import Insights from './pages/Insights'
import Live from './pages/Live'
import Reports from './pages/Reports'
import Settings from './pages/Settings'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-lg p-10">
          <EmptyState title="Something went wrong on this page" body={this.state.error.message} action={<button className="text-sm font-semibold text-sky-700" onClick={() => location.reload()}>Reload</button>} />
        </div>
      )
    }
    return this.props.children
  }
}

// The online preview runs inside a sandboxed frame, so routes are kept in memory there instead of the URL hash.
const Router = __PREVIEW__ ? MemoryRouter : HashRouter

export default function App() {
  return (
    <ErrorBoundary>
      <StoreProvider>
        <Router>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="live" element={<Live />} />
              <Route path="assistant" element={<Assistant />} />
              <Route path="insights" element={<Insights />} />
              <Route path="alerts" element={<Alerts />} />
              <Route path="reports" element={<Reports />} />
              <Route path="settings" element={<Settings />} />
              <Route path="*" element={<EmptyState title="Page not found" action={<Link className="text-sm font-semibold text-sky-700" to="/">Go to dashboard</Link>} />} />
            </Route>
          </Routes>
        </Router>
      </StoreProvider>
    </ErrorBoundary>
  )
}
