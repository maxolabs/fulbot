'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, MessageCircle, Clock, Save, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { createClient } from '@/lib/supabase/client'

interface NotificationSettingsProps {
  groupId: string
  settings: {
    id: string | null
    send_signup_link_on_create: boolean
    reminder_hours_before: number
    notify_on_waitlist_promotion: boolean
    notify_on_teams_created: boolean
    whatsapp_webhook_url: string | null
  }
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
        checked ? 'bg-primary' : 'bg-gray-200'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

export function NotificationSettings({ groupId, settings: initialSettings }: NotificationSettingsProps) {
  const router = useRouter()
  const supabase = createClient()

  const [settings, setSettings] = useState(initialSettings)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSuccess(false)

    try {
      const data = {
        group_id: groupId,
        send_signup_link_on_create: settings.send_signup_link_on_create,
        reminder_hours_before: settings.reminder_hours_before,
        notify_on_waitlist_promotion: settings.notify_on_waitlist_promotion,
        notify_on_teams_created: settings.notify_on_teams_created,
        whatsapp_webhook_url: settings.whatsapp_webhook_url || null,
      }

      if (settings.id) {
        // Update existing
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: updateError } = await (supabase as any)
          .from('notification_settings')
          .update(data)
          .eq('id', settings.id)

        if (updateError) throw updateError
      } else {
        // Insert new
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: newSettings, error: insertError } = await (supabase as any)
          .from('notification_settings')
          .insert(data)
          .select('id')
          .single()

        if (insertError) throw insertError
        setSettings(prev => ({ ...prev, id: newSettings.id }))
      }

      setSuccess(true)
      router.refresh()
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      console.error('Error saving notification settings:', err)
      setError('Error al guardar la configuración')
    } finally {
      setSaving(false)
    }
  }

  const hasChanges = JSON.stringify(settings) !== JSON.stringify(initialSettings)

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-md bg-green-500/10 px-4 py-3 text-sm text-green-600">
          Configuración guardada correctamente
        </div>
      )}

      {/* Auto-send signup link */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
            <MessageCircle className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <Label className="text-base">Enviar link de inscripción</Label>
            <p className="text-sm text-muted-foreground">
              Al crear un partido, copiar automáticamente el link de inscripción
            </p>
          </div>
        </div>
        <Toggle
          checked={settings.send_signup_link_on_create}
          onChange={(checked) =>
            setSettings((prev) => ({ ...prev, send_signup_link_on_create: checked }))
          }
        />
      </div>

      {/* Reminder hours */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-orange-100 flex items-center justify-center">
            <Clock className="h-5 w-5 text-orange-600" />
          </div>
          <div>
            <Label className="text-base">Recordatorio antes del partido</Label>
            <p className="text-sm text-muted-foreground">
              Horas antes del partido para enviar recordatorio
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={0}
            max={48}
            value={settings.reminder_hours_before}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                reminder_hours_before: parseInt(e.target.value) || 0,
              }))
            }
            className="w-20 text-center"
          />
          <span className="text-sm text-muted-foreground">horas</span>
        </div>
      </div>

      {/* Waitlist promotion notification */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-green-100 flex items-center justify-center">
            <Users className="h-5 w-5 text-green-600" />
          </div>
          <div>
            <Label className="text-base">Notificar promoción de lista de espera</Label>
            <p className="text-sm text-muted-foreground">
              Avisar cuando un jugador pasa de lista de espera a confirmado
            </p>
          </div>
        </div>
        <Toggle
          checked={settings.notify_on_waitlist_promotion}
          onChange={(checked) =>
            setSettings((prev) => ({ ...prev, notify_on_waitlist_promotion: checked }))
          }
        />
      </div>

      {/* Teams created notification */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-purple-100 flex items-center justify-center">
            <Bell className="h-5 w-5 text-purple-600" />
          </div>
          <div>
            <Label className="text-base">Notificar cuando se armen equipos</Label>
            <p className="text-sm text-muted-foreground">
              Avisar al grupo cuando se generan los equipos para un partido
            </p>
          </div>
        </div>
        <Toggle
          checked={settings.notify_on_teams_created}
          onChange={(checked) =>
            setSettings((prev) => ({ ...prev, notify_on_teams_created: checked }))
          }
        />
      </div>

      {/* WhatsApp webhook */}
      <div className="space-y-3 pt-4 border-t">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-green-100 flex items-center justify-center">
            <MessageCircle className="h-5 w-5 text-green-600" />
          </div>
          <div>
            <Label className="text-base">Webhook de WhatsApp (opcional)</Label>
            <p className="text-sm text-muted-foreground">
              URL para enviar notificaciones automáticas a WhatsApp
            </p>
          </div>
        </div>
        <Input
          type="url"
          placeholder="https://..."
          value={settings.whatsapp_webhook_url || ''}
          onChange={(e) =>
            setSettings((prev) => ({ ...prev, whatsapp_webhook_url: e.target.value }))
          }
          className="font-mono text-sm"
        />
        <p className="text-xs text-muted-foreground">
          Compatible con servicios como Twilio, WhatsApp Business API, o webhooks personalizados.
        </p>
      </div>

      {/* Save button */}
      {hasChanges && (
        <div className="flex justify-end pt-4 border-t">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Spinner size="sm" className="mr-2" />
                Guardando...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Guardar cambios
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
