'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { createClient } from '@/lib/supabase/client'

interface DangerZoneProps {
  groupId: string
  groupName: string
}

export function DangerZone({ groupId, groupName }: DangerZoneProps) {
  const router = useRouter()
  const supabase = createClient()

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [loading, setLoading] = useState(false)

  const handleDeleteGroup = async () => {
    if (deleteConfirmText !== groupName) {
      alert('El nombre no coincide')
      return
    }

    setLoading(true)

    try {
      // Delete the group (CASCADE will handle related records)
      const { error } = await supabase.from('groups').delete().eq('id', groupId)

      if (error) throw error

      router.push('/groups')
      router.refresh()
    } catch (err) {
      console.error('Error deleting group:', err)
      alert('Error al eliminar el grupo')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      {!showDeleteConfirm ? (
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">Eliminar grupo</p>
            <p className="text-sm text-muted-foreground">
              Elimina permanentemente el grupo y todos sus datos
            </p>
          </div>
          <Button
            variant="destructive"
            onClick={() => setShowDeleteConfirm(true)}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Eliminar grupo
          </Button>
        </div>
      ) : (
        <div className="border border-destructive/50 rounded-lg p-4 space-y-4">
          <p className="text-sm">
            Esta acción <strong>no se puede deshacer</strong>. Se eliminarán todos los
            partidos, inscripciones, equipos y estadísticas del grupo.
          </p>
          <p className="text-sm">
            Escribe <strong>{groupName}</strong> para confirmar:
          </p>
          <Input
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            placeholder={groupName}
            disabled={loading}
          />
          <div className="flex gap-2">
            <Button
              variant="destructive"
              onClick={handleDeleteGroup}
              disabled={loading || deleteConfirmText !== groupName}
            >
              {loading && <Spinner size="sm" className="mr-2" />}
              Confirmar eliminación
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setShowDeleteConfirm(false)
                setDeleteConfirmText('')
              }}
              disabled={loading}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
