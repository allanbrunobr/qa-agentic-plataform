import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, X } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import type { ApiPersona } from '@/lib/mock-data'
import { cn } from '@/lib/utils'
import { api, type CreatePersonaPayload } from '@/lib/api'

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
}

const itemVariants = {
  hidden: { opacity: 0, scale: 0.97 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.3 } },
}

const PRESET_COLORS = [
  '#3b82f6',
  '#a855f7',
  '#22c55e',
  '#f97316',
  '#ef4444',
  '#eab308',
]

interface CreatePersonaForm {
  name: string
  role: string
  description: string
  modules: string[]
  color: string
  context: string
}

const EMPTY_FORM: CreatePersonaForm = {
  name: '',
  role: '',
  description: '',
  modules: [],
  color: PRESET_COLORS[0],
  context: '',
}

function LoadingState() {
  return (
    <div className="flex h-64 items-center justify-center text-sm text-[var(--text-muted)]">
      Loading...
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-2 text-[var(--text-muted)]">
      <p className="text-sm">{message}</p>
      <p className="text-xs">Run tests to populate data</p>
    </div>
  )
}

function CreatePersonaModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void
  onSubmit: (form: CreatePersonaForm) => void
}) {
  const [form, setForm] = useState<CreatePersonaForm>(EMPTY_FORM)
  const [moduleInput, setModuleInput] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleAddModule = useCallback(() => {
    const trimmed = moduleInput.trim()
    if (trimmed && !form.modules.includes(trimmed)) {
      setForm(prev => ({ ...prev, modules: [...prev.modules, trimmed] }))
      setModuleInput('')
    }
  }, [moduleInput, form.modules])

  const handleRemoveModule = useCallback((mod: string) => {
    setForm(prev => ({ ...prev, modules: prev.modules.filter(m => m !== mod) }))
  }, [])

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.role.trim()) return
    setSubmitting(true)
    onSubmit(form)
    setSubmitting(false)
  }

  const inputClasses =
    'w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]/50 focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/30'

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 20 }}
        transition={{ duration: 0.2 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-lg"
      >
        <Card className="max-h-[85vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              Create Persona
            </h2>
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-4">
            {/* Name */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">
                Name <span className="text-[var(--danger)]">*</span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g. Maria Santos"
                className={inputClasses}
              />
            </div>

            {/* Role */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">
                Role <span className="text-[var(--danger)]">*</span>
              </label>
              <input
                type="text"
                value={form.role}
                onChange={e => setForm(prev => ({ ...prev, role: e.target.value }))}
                placeholder="e.g. Radiologist"
                className={inputClasses}
              />
            </div>

            {/* Description */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">
                Description
              </label>
              <textarea
                value={form.description}
                onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="What does this persona test?"
                rows={2}
                className={cn(inputClasses, 'resize-none')}
              />
            </div>

            {/* Modules */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">
                Modules
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={moduleInput}
                  onChange={e => setModuleInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleAddModule()
                    }
                  }}
                  placeholder="Type module name, press Enter"
                  className={cn(inputClasses, 'flex-1')}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleAddModule}
                  disabled={!moduleInput.trim()}
                >
                  Add
                </Button>
              </div>
              {form.modules.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {form.modules.map(mod => (
                    <button
                      key={mod}
                      onClick={() => handleRemoveModule(mod)}
                      className="group flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium transition-colors"
                      style={{
                        backgroundColor: `${form.color}20`,
                        color: form.color,
                        border: `1px solid ${form.color}30`,
                      }}
                    >
                      {mod}
                      <X className="h-2.5 w-2.5 opacity-50 group-hover:opacity-100" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Color */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">
                Color
              </label>
              <div className="flex items-center gap-2">
                {PRESET_COLORS.map(color => (
                  <button
                    key={color}
                    onClick={() => setForm(prev => ({ ...prev, color }))}
                    className={cn(
                      'h-8 w-8 rounded-full transition-all',
                      form.color === color
                        ? 'ring-2 ring-offset-2 ring-offset-[var(--bg-card)] scale-110'
                        : 'hover:scale-105',
                    )}
                    style={{
                      backgroundColor: color,
                      boxShadow: form.color === color ? `0 0 0 2px ${color}` : undefined,
                    }}
                    aria-label={`Select color ${color}`}
                  />
                ))}
              </div>
            </div>

            {/* Context */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">
                Context
              </label>
              <textarea
                value={form.context}
                onChange={e => setForm(prev => ({ ...prev, context: e.target.value }))}
                placeholder="Additional context about what this persona tests..."
                rows={3}
                className={cn(inputClasses, 'resize-none')}
              />
            </div>
          </div>

          {/* Actions */}
          <div className="mt-6 flex items-center justify-end gap-3">
            <Button variant="ghost" size="md" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={handleSubmit}
              loading={submitting}
              disabled={!form.name.trim() || !form.role.trim()}
            >
              Create Persona
            </Button>
          </div>
        </Card>
      </motion.div>
    </motion.div>
  )
}

export function Personas() {
  const [showCreate, setShowCreate] = useState(false)
  const [personas, setPersonas] = useState<ApiPersona[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    api.getPersonas()
      .then(d => setPersonas(d as ApiPersona[]))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleCreate = useCallback(async (form: CreatePersonaForm) => {
    try {
      const payload: CreatePersonaPayload = {
        name: form.name,
        role: form.role,
        description: form.description,
        modules: form.modules,
        color: form.color,
        context: form.context,
      }
      await api.createPersona(payload)
      // Refresh the list
      const updated = await api.getPersonas() as ApiPersona[]
      setPersonas(updated)
      setShowCreate(false)
      setToast(`Persona "${form.name}" created successfully`)
      setTimeout(() => setToast(null), 3000)
    } catch {
      setToast('Failed to create persona')
      setTimeout(() => setToast(null), 3000)
    }
  }, [])

  if (loading) return <LoadingState />

  return (
    <div className="p-6">
      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-4 right-4 z-50 flex items-center gap-2 rounded-lg border border-[var(--success)]/30 bg-[var(--bg-card)] px-4 py-2.5 text-sm font-medium text-[var(--success)] shadow-lg"
          >
            <span className="h-2 w-2 rounded-full bg-[var(--success)]" />
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create modal */}
      <AnimatePresence>
        {showCreate && (
          <CreatePersonaModal
            onClose={() => setShowCreate(false)}
            onSubmit={handleCreate}
          />
        )}
      </AnimatePresence>

      <div className="mb-6 flex items-center justify-between">
        <p className="text-sm text-[var(--text-muted)]">
          {personas.length} personas active
        </p>
        <Button
          variant="primary"
          size="md"
          icon={<Plus className="h-3.5 w-3.5" />}
          onClick={() => setShowCreate(true)}
        >
          Create Persona
        </Button>
      </div>

      {personas.length === 0 ? (
        <EmptyState message="No personas configured yet." />
      ) : (
        <motion.div
          className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          {personas.map((persona, idx) => {
            const color = persona.color ?? PRESET_COLORS[idx % PRESET_COLORS.length]
            const initials = persona.name
              .split(' ')
              .map(w => w[0])
              .join('')
              .toUpperCase()
              .slice(0, 2)

            return (
              <motion.div key={persona.slug} variants={itemVariants}>
                <Card hoverable className="flex h-full flex-col">
                  {/* Avatar + name */}
                  <div className="mb-4 flex items-start gap-4">
                    <div
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-bold text-white shadow-lg"
                      style={{
                        backgroundColor: color,
                        boxShadow: `0 0 20px ${color}40`,
                      }}
                    >
                      {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-[var(--text-primary)]">
                        {persona.name}
                      </h3>
                      <p
                        className="text-xs font-medium"
                        style={{ color }}
                      >
                        {persona.role}
                      </p>
                      <p className="mt-1.5 text-xs text-[var(--text-muted)] leading-relaxed">
                        {persona.description}
                      </p>
                    </div>
                  </div>

                  {/* Modules */}
                  <div className="mb-4">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                      Modules Covered
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {persona.modules.map(mod => (
                        <span
                          key={mod}
                          className="rounded-md px-2 py-0.5 text-xs font-medium"
                          style={{
                            backgroundColor: `${color}20`,
                            color: color,
                            border: `1px solid ${color}30`,
                          }}
                        >
                          {mod}
                        </span>
                      ))}
                    </div>
                  </div>
                </Card>
              </motion.div>
            )
          })}
        </motion.div>
      )}
    </div>
  )
}
