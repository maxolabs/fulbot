'use client'

import { useEffect, useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { SlidersHorizontal, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/i18n/provider'

// Admin-only actions on a member score (docs/member-scoring.md §4.4): a manual
// +/- adjustment with a mandatory note, and deleting a wrong event. Both RPCs
// recompute the score, so the caller only needs a router.refresh().

// supabase.rpc resolves with a plain PostgrestError: read the SQL layer's
// Spanish message off `.message`.
function errorMessage(err: unknown, fallback: string): string {
  const message = (err as { message?: unknown } | null)?.message
  return typeof message === 'string' && message.trim() ? message : fallback
}

interface AdjustProps {
  groupId: string
  playerId: string
}

export function MemberScoreAdjust({ groupId, playerId }: AdjustProps) {
  const t = useT()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [points, setPoints] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleId = useId()
  const pointsId = useId()
  const noteId = useId()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const close = () => {
    if (saving) return
    setOpen(false)
    setError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const value = Number(points)
    if (!Number.isInteger(value) || value === 0 || value < -20 || value > 20) {
      setError(t('memberScore.pointsInvalid'))
      return
    }
    if (!note.trim()) {
      setError(t('memberScore.noteRequired'))
      return
    }
    setSaving(true)
    setError(null)
    try {
      const supabase = createClient()
      const { error: rpcError } = await supabase.rpc('admin_adjust_member_score', {
        p_group_id: groupId,
        p_player_id: playerId,
        p_points: value,
        p_note: note.trim(),
      })
      if (rpcError) throw rpcError
      setOpen(false)
      setPoints('')
      setNote('')
      router.refresh()
    } catch (err) {
      setError(errorMessage(err, t('memberScore.adjustError')))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="member-score-adjust">
        <SlidersHorizontal className="mr-2 h-4 w-4" />
        {t('memberScore.adjust')}
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50" onClick={close}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="w-full max-w-md rounded-2xl border border-border/50 bg-card text-card-foreground shadow-lg p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id={titleId} className="text-lg font-semibold">{t('memberScore.adjustTitle')}</h2>
                <p className="text-sm text-muted-foreground mt-1">{t('memberScore.adjustDescription')}</p>
              </div>
              <button
                type="button"
                onClick={close}
                className="rounded-md p-1 text-muted-foreground hover:text-foreground"
                aria-label={t('common.close')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-5 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor={pointsId}>{t('memberScore.points')}</Label>
                <Input
                  id={pointsId}
                  type="number"
                  inputMode="numeric"
                  min={-20}
                  max={20}
                  step={1}
                  required
                  value={points}
                  onChange={(e) => setPoints(e.target.value)}
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">{t('memberScore.pointsHint')}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={noteId}>{t('memberScore.note')}</Label>
                <textarea
                  id={noteId}
                  required
                  rows={3}
                  maxLength={500}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t('memberScore.notePlaceholder')}
                  className="flex w-full rounded-xl border border-border/50 bg-card/50 px-4 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
                />
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" onClick={close} disabled={saving}>
                  {t('common.cancel')}
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? t('memberScore.saving') : t('memberScore.saveAdjustment')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}

interface DeleteProps {
  eventId: string
}

export function MemberEventDeleteButton({ eventId }: DeleteProps) {
  const t = useT()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDelete = async () => {
    if (!confirm(t('memberScore.deleteEventConfirm'))) return
    setBusy(true)
    setError(null)
    try {
      const supabase = createClient()
      const { error: rpcError } = await supabase.rpc('admin_delete_member_event', { p_event_id: eventId })
      if (rpcError) throw rpcError
      router.refresh()
    } catch (err) {
      setError(errorMessage(err, t('memberScore.deleteEventError')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={handleDelete}
        disabled={busy}
        className="rounded-md p-1 text-muted-foreground hover:text-destructive disabled:opacity-50"
        aria-label={t('memberScore.deleteEvent')}
        title={t('memberScore.deleteEvent')}
      >
        <Trash2 className="h-4 w-4" />
      </button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  )
}
