import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Sidebar, type Page } from '@/components/layout/Sidebar'
import { Header } from '@/components/layout/Header'
import { Overview } from '@/pages/Overview'
import { AgenticRuns } from '@/pages/AgenticRuns'
import { Personas } from '@/pages/Personas'
import { Insights } from '@/pages/Insights'
import { Settings } from '@/pages/Settings'
import { CodeGraph } from '@/pages/CodeGraph'

const PAGE_TITLES: Record<Page, string> = {
  overview: 'Agentic overview',
  scenarios: 'Scenarios',
  findings: 'Findings',
  runs: 'Runs',
  'agentic-runs': 'Agentic runs',
  personas: 'Personas',
  'pr-tracking': 'PR tracking',
  insights: 'Insights',
  'code-graph': 'Code graph',
  settings: 'Settings',
}

const pageVariants = {
  initial: { opacity: 0, x: 10 },
  animate: { opacity: 1, x: 0, transition: { duration: 0.2 } },
  exit: { opacity: 0, x: -10, transition: { duration: 0.15 } },
}

export default function App() {
  const [activePage, setActivePage] = useState<Page>('overview')

  useEffect(() => {
    const syncFromHash = () => {
      const hash = window.location.hash.replace(/^#/, '')
      const [page] = hash.split('?')
      if (page === 'agentic-runs') {
        setActivePage('agentic-runs')
      } else if (page === 'overview') {
        setActivePage('overview')
      } else if (page === 'personas') {
        setActivePage('personas')
      } else if (page === 'insights') {
        setActivePage('insights')
      } else if (page === 'code-graph') {
        setActivePage('code-graph')
      } else if (page === 'settings') {
        setActivePage('settings')
      }
    }

    const handleAgenticRunStarted = () => setActivePage('agentic-runs')

    syncFromHash()
    window.addEventListener('hashchange', syncFromHash)
    window.addEventListener('agentic-run-started', handleAgenticRunStarted)
    return () => {
      window.removeEventListener('hashchange', syncFromHash)
      window.removeEventListener('agentic-run-started', handleAgenticRunStarted)
    }
  }, [])

  function renderPage() {
    switch (activePage) {
      case 'overview': return <Overview />
      case 'agentic-runs': return <AgenticRuns />
      case 'personas': return <Personas />
      case 'insights': return <Insights />
      case 'code-graph': return <CodeGraph />
      case 'settings': return <Settings />
      default: return <Overview />
    }
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
      <Sidebar activePage={activePage} onNavigate={setActivePage} />

      <div className="flex flex-1 flex-col overflow-hidden">
        <Header title={PAGE_TITLES[activePage]} />

        <main className="flex-1 overflow-y-auto" role="main">
          <AnimatePresence mode="wait">
            <motion.div
              key={activePage}
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="h-full"
            >
              {renderPage()}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  )
}
