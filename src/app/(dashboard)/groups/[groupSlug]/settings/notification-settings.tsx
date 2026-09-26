'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, MessageCircle, Clock, Save, Users, ClipboardList } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/i18n/provider'
import { FormNotice, Toggle } from '@/components/form-controls'
import { checkWebhookUrl, type WebhookUrlProblem } from '@/lib/notifications/webhook-url'

const WEBHOOK_PROBLEM_KEY: Record<WebhookUrlProblem, string> = {
  invalid: 'ui.notify.webhookInvalid',
  https: 'ui.notify.webhookHttps',
  credentials: 'ui.notify.webhookCredentials',
  host: 'ui.notify.webhookHost',
}

interface NotificationSettingsProps {
  groupId: string
  settings: {
    id: string | null
    send_signup_link_on_create: boolean
    reminder_hours_before: number
    notify_on_waitlist_promotion: boolean
    notify_on_teams_created: boolean
    whatsapp_webhook_url: string | null
    // Crowd-sourced results (docs/match-results-consensus.md §11.1): group
    // defaults copied onto each new match, plus the reminder/window timing.
    default_duration_minutes: number
    default_results_request_delay_minutes: number
    results_reminder_hours: number
    results_window_days: number
  }
}

function toInt(value: string, fallback: number): number {
  const n = parseInt(value, 10)
  return Number.isFinite(n) ? n : fallback
}

export function NotificationSettings({ groupId, settings: initialSettings }: NotificationSettingsProps) {
  const t = useT()
  const router = useRouter()
  const supabase = createClient()

  const [settings, setSettings] = useState(initialSettings)
  const [reminderText, setReminderText] = useState(String(initialSettings.reminder_hours_before))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleSave = async () => {
    setError(null)
    setSuccess(false)

    // Validate before writing: a bad number used to become 0 and silently
    // switch reminders off, and the webhook URL is fetched by the server.
    const hours = settings.reminder_hours_before
    if (!Number.isInteger(hours) || hours < 0 || hours > 48) {
      setError(t('ui.notify.reminderInvalid'))
      return
    }
    const webhookUrl = settings.whatsapp_webhook_url?.trim() || null
    const webhookProblem = webhookUrl ? checkWebhookUrl(webhookUrl) : null
    if (webhookProblem) {
      setError(t(WEBHOOK_PROBLEM_KEY[webhookProblem]))
      return
    }

    setSaving(true)

    try {
      const data = {
        group_id: groupId,
        send_signup_link_on_create: settings.send_signup_link_on_create,
        reminder_hours_before: settings.reminder_hours_before,
        notify_on_waitlist_promotion: settings.notify_on_waitlist_promotion,
        notify_on_teams_created: settings.notify_on_teams_created,
        whatsapp_webhook_url: webhookUrl,
        default_duration_minutes: settings.default_duration_minutes,
        default_results_request_delay_minutes: settings.default_results_request_delay_minutes,
        results_reminder_hours: settings.results_reminder_hours,
        results_window_days: settings.results_window_days,
      }

      if (settings.id) {
        // Update existing
        const { error: updateError } = await supabase
          .from('notification_settings')
          .update(data)
          .eq('id', settings.id)

        if (updateError) throw updateError
      } else {
        // Insert new
        const { data: newSettings, error: insertError } = await supabase
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
      setError(t('ui.notify.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const hasChanges = JSON.stringify(settings) !== JSON.stringify(initialSettings)

  return (
    <div className="space-y-6">
      {error && <FormNotice kind="error">{error}</FormNotice>}

      {success && <FormNotice kind="success">{t('ui.notify.saved')}</FormNotice>}

      {/* Auto-send signup link */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-secondary">
            <MessageCircle className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-medium">{t('sharing.signupNoticeTitle')}</p>
            <p className="text-sm text-muted-foreground">
              {t('sharing.signupNoticeDescription')}
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
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-secondary">
            <Clock className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-medium">{t('ui.notify.reminderTitle')}</p>
            <p className="text-sm text-muted-foreground">
              {t('ui.notify.reminderDesc')}
            </p>
            <p className="text-xs text-muted-foreground">{t('ui.notify.reminderHint')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={0}
            max={48}
            step={1}
            value={reminderText}
            onChange={(e) => {
              setReminderText(e.target.value)
              setSettings((prev) => ({
                ...prev,
                // NaN / out of range is kept as typed and rejected on save.
                reminder_hours_before: e.target.value.trim() === '' ? NaN : Number(e.target.value),
              }))
            }}
            aria-invalid={!Number.isInteger(settings.reminder_hours_before) || settings.reminder_hours_before < 0 || settings.reminder_hours_before > 48}
            className="w-20 text-center"
          />
          <span className="text-sm text-muted-foreground">{t('ui.notify.hours')}</span>
        </div>
      </div>

      {/* Waitlist promotion notification */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-secondary">
            <Users className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-medium">{t('ui.notify.waitlistTitle')}</p>
            <p className="text-sm text-muted-foreground">
              {t('ui.notify.waitlistDesc')}
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
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-secondary">
            <Bell className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-medium">{t('ui.notify.teamsTitle')}</p>
            <p className="text-sm text-muted-foreground">
              {t('ui.notify.teamsDesc')}
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

      {/* Crowd-sourced results: timing defaults */}
      <div className="space-y-4 pt-4 border-t">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-secondary">
            <ClipboardList className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-medium">{t('ui.notify.resultsTitle')}</p>
            <p className="text-sm text-muted-foreground">
              {t('ui.notify.resultsDesc')}
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="default_duration_minutes">{t('ui.notify.durationLabel')}</Label>
            <div className="flex items-center gap-2">
              <Input
                id="default_duration_minutes"
                type="number"
                min={10}
                max={240}
                step={5}
                value={settings.default_duration_minutes}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    default_duration_minutes: toInt(e.target.value, prev.default_duration_minutes),
                  }))
                }
                className="w-24 text-center"
              />
              <span className="text-sm text-muted-foreground">{t('ui.notify.minutes')}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('ui.notify.durationHint')}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="default_results_request_delay_minutes">{t('ui.notify.requestLabel')}</Label>
            <div className="flex items-center gap-2">
              <Input
                id="default_results_request_delay_minutes"
                type="number"
                min={0}
                max={1440}
                step={5}
                value={settings.default_results_request_delay_minutes}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    default_results_request_delay_minutes: toInt(
                      e.target.value,
                      prev.default_results_request_delay_minutes
                    ),
                  }))
                }
                className="w-24 text-center"
              />
              <span className="text-sm text-muted-foreground">{t('ui.notify.minutesAfterEnd')}</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="results_reminder_hours">{t('ui.notify.resultsReminderLabel')}</Label>
            <div className="flex items-center gap-2">
              <Input
                id="results_reminder_hours"
                type="number"
                min={0}
                max={168}
                value={settings.results_reminder_hours}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    results_reminder_hours: toInt(e.target.value, prev.results_reminder_hours),
                  }))
                }
                className="w-24 text-center"
              />
              <span className="text-sm text-muted-foreground">{t('ui.notify.hoursAfterRequest')}</span>
            </div>
            <p className="text-xs text-muted-foreground">{t('ui.notify.noReminder')}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="results_window_days">{t('ui.notify.windowLabel')}</Label>
            <div className="flex items-center gap-2">
              <Input
                id="results_window_days"
                type="number"
                min={1}
                max={30}
                value={settings.results_window_days}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    results_window_days: toInt(e.target.value, prev.results_window_days),
                  }))
                }
                className="w-24 text-center"
              />
              <span className="text-sm text-muted-foreground">{t('ui.notify.daysAfterMatch')}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('ui.notify.windowHint')}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3 border-t pt-4">
        <p className="flex items-center gap-2 text-sm font-medium"><MessageCircle className="h-4 w-4" aria-hidden="true" />WhatsApp</p>
        <p className="text-sm text-muted-foreground">{t('sharing.noSetup')}</p>
        <details className="rounded-md border border-border p-3">
          <summary className="cursor-pointer py-3 text-sm text-muted-foreground">{t('sharing.advancedDelivery')}</summary>
          <div className="mt-3 space-y-2">
            <Label htmlFor="whatsapp_webhook_url">{t('sharing.webhookUrl')}</Label>
            <Input
              id="whatsapp_webhook_url" type="url" placeholder="https://..."
              value={settings.whatsapp_webhook_url || ''}
              onChange={(e) => setSettings((prev) => ({ ...prev, whatsapp_webhook_url: e.target.value }))}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">{t('sharing.advancedHint')}</p>
          </div>
        </details>
      </div>

      {/* Save button */}
      {hasChanges && (
        <div className="flex justify-end pt-4 border-t">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Spinner size="sm" />
                {t('ui.notify.saving')}
              </>
            ) : (
              <>
                <Save className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                {t('ui.notify.save')}
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
