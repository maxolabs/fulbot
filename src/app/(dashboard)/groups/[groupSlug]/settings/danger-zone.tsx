'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { FormNotice } from '@/components/form-controls'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/i18n/provider'

interface DangerZoneProps {
  groupId: string
  groupName: string
}

export function DangerZone({ groupId, groupName }: DangerZoneProps) {
  const router = useRouter()
  const supabase = createClient()
  const t = useT()

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDeleteGroup = async () => {
    if (deleteConfirmText !== groupName) {
      setError(t('ui.dangerZone.mismatch'))
      return
    }

    setLoading(true)
    setError(null)

    try {
      // Delete the group (CASCADE will handle related records). RLS filters the
      // row out for non-admins, which deletes nothing without an error, so ask
      // for the deleted row back and treat an empty result as a failure.
      const { data, error } = await supabase
        .from('groups')
        .delete()
        .eq('id', groupId)
        .select('id')

      if (error) throw error
      if (!data || data.length === 0) throw new Error('Group not deleted')

      router.push('/groups')
      router.refresh()
    } catch (err) {
      console.error('Error deleting group:', err)
      setError(t('ui.dangerZone.error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      {!showDeleteConfirm ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium">{t('ui.dangerZone.title')}</p>
            <p className="text-sm text-muted-foreground">
              {t('ui.dangerZone.description')}
            </p>
          </div>
          <Button
            variant="destructive"
            onClick={() => setShowDeleteConfirm(true)}
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            {t('ui.dangerZone.title')}
          </Button>
        </div>
      ) : (
        <div className="space-y-4 rounded-md border border-destructive p-4">
          {error && <FormNotice kind="error">{error}</FormNotice>}
          <p className="text-sm">{t('ui.dangerZone.warning')}</p>
          <p className="text-sm">
            {t('ui.dangerZone.typeToConfirm')} <strong>{groupName}</strong>
          </p>
          <Input
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            placeholder={groupName}
            disabled={loading}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="destructive"
              onClick={handleDeleteGroup}
              disabled={loading || deleteConfirmText !== groupName}
            >
              {loading && <Spinner size="sm" />}
              {t('ui.dangerZone.confirm')}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setShowDeleteConfirm(false)
                setDeleteConfirmText('')
              }}
              disabled={loading}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
