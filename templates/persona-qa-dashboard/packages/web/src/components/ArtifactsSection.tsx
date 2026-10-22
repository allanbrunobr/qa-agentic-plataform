import { useState } from 'react'
import { ChevronDown, ChevronUp, Info } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ArtifactsSectionProps {
  artifacts: Record<string, unknown> | null | undefined
  className?: string
  defaultOpen?: boolean
}

const STUB_VALUES = ['shipping-engine-managed', 'engine-managed', 'auto-generated']

const ARTIFACT_LABELS: Record<string, string> = {
  customer_id: 'Customer ID',
  order_id: 'Order ID',
  cancelled_order_id: 'Cancelled Order ID',
  modified_order_id: 'Modified Order ID',
  shipment_id: 'Shipment ID',
  invoice_id: 'Invoice ID',
}

function isStubValue(value: unknown): boolean {
  if (typeof value !== 'string') return false
  return STUB_VALUES.includes(value)
}

export function ArtifactsSection({ artifacts, className, defaultOpen = false }: ArtifactsSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  if (!artifacts || Object.keys(artifacts).length === 0) return null

  const entries = Object.entries(artifacts)

  return (
    <div className={cn('rounded-lg bg-[var(--bg-primary)] overflow-hidden', className)}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between p-3 text-left transition-colors hover:bg-[var(--bg-hover)]"
      >
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Artefatos ({entries.length})
        </p>
        {isOpen ? (
          <ChevronUp className="h-3.5 w-3.5 text-[var(--text-muted)]" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-[var(--text-muted)]" />
        )}
      </button>

      {isOpen && (
        <div className="border-t border-[var(--border)] px-3 pb-3">
          <div className="mt-2 space-y-1.5">
            {entries.map(([key, value]) => {
              const label = ARTIFACT_LABELS[key] ?? key
              const displayValue = value == null ? '—' : String(value)
              const isStub = isStubValue(value)

              return (
                <div key={key} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-[var(--text-muted)] font-mono">{label}</span>
                  <span className="flex items-center gap-1 text-[var(--text-primary)] font-mono">
                    {displayValue}
                    {isStub && (
                      <span className="group relative">
                        <Info className="h-3 w-3 text-[var(--text-muted)] cursor-help" />
                        <span className="absolute bottom-full right-0 mb-1 hidden w-48 rounded bg-[var(--bg-secondary)] p-2 text-[10px] text-[var(--text-muted)] shadow-lg group-hover:block z-10">
                          Valor gerenciado pelo motor de regras. Não é um ID real do sistema.
                        </span>
                      </span>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
