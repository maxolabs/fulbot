'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, Users, Trophy, CalendarClock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { useT } from '@/i18n/provider'
import type { Language } from '@/i18n/use-translations'
import { saveSettings, type ThemePreference, type NotificationPrefsInput } from './actions'

interface SettingsFormProps {
  initialLanguage: Language
  initialTheme: ThemePreference
  initialNotificationPrefs: NotificationPrefsInput
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
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50 disabled:cursor-not-allowed ${
        checked ? 'bg-primary' : 'bg-muted'
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

function applyThemePreview(theme: ThemePreference) {
  if (typeof document === 'undefined') return
  const classList = document.documentElement.classList
  if (theme === 'dark') {
    classList.add('dark')
  } else if (theme === 'light') {
    classList.remove('dark')
  } else {
    try {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      classList.toggle('dark', prefersDark)
    } catch {
      // ignore
    }
  }
}

const selectClass =
  'flex h-11 w-full rounded-xl border border-border/50 bg-card/50 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 disabled:opacity-50 transition-colors sm:max-w-xs'

export function SettingsForm({
  initialLanguage,
  initialTheme,
  initialNotificationPrefs,
}: SettingsFormProps) {
  const t = useT()
  const router = useRouter()

  const [language, setLanguage] = useState<Language>(initialLanguage)
  const [theme, setTheme] = useState<ThemePreference>(initialTheme)
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPrefsInput>(initialNotificationPrefs)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleThemeChange = (value: ThemePreference) => {
    setTheme(value)
    applyThemePreview(value)
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSuccess(false)

    try {
      await saveSettings({ language, theme, notificationPrefs })
      setSuccess(true)
      router.refresh()
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      console.error('Error saving settings:', err)
      setError(t('settings.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const notificationItems: {
    key: keyof NotificationPrefsInput
    icon: typeof Bell
    title: string
    desc: string
  }[] = [
    {
      key: 'waitlist_promoted',
      icon: Users,
      title: t('settings.notifWaitlistPromotedTitle'),
      desc: t('settings.notifWaitlistPromotedDesc'),
    },
    {
      key: 'teams_created',
      icon: Bell,
      title: t('settings.notifTeamsCreatedTitle'),
      desc: t('settings.notifTeamsCreatedDesc'),
    },
    {
      key: 'match_reminder',
      icon: CalendarClock,
      title: t('settings.notifMatchReminderTitle'),
      desc: t('settings.notifMatchReminderDesc'),
    },
    {
      key: 'results_posted',
      icon: Trophy,
      title: t('settings.notifResultsPostedTitle'),
      desc: t('settings.notifResultsPostedDesc'),
    },
  ]

  return (
    <div className="space-y-8">
      {error && (
        <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-md bg-green-500/10 px-4 py-3 text-sm text-green-600">
          {t('settings.saved')}
        </div>
      )}

      {/* Language */}
      <div className="space-y-2">
        <Label htmlFor="language">{t('settings.language')}</Label>
        <p className="text-sm text-muted-foreground">{t('settings.languageDescription')}</p>
        <select
          id="language"
          value={language}
          onChange={(e) => setLanguage(e.target.value as Language)}
          disabled={saving}
          className={selectClass}
        >
          <option value="es">{t('auth.languageEs')}</option>
          <option value="en">{t('auth.languageEn')}</option>
        </select>
      </div>

      {/* Theme */}
      <div className="space-y-2 pt-4 border-t border-border/50">
        <Label htmlFor="theme">{t('settings.theme')}</Label>
        <p className="text-sm text-muted-foreground">{t('settings.themeDescription')}</p>
        <select
          id="theme"
          value={theme}
          onChange={(e) => handleThemeChange(e.target.value as ThemePreference)}
          disabled={saving}
          className={selectClass}
        >
          <option value="light">{t('settings.themeLight')}</option>
          <option value="dark">{t('settings.themeDark')}</option>
          <option value="system">{t('settings.themeSystem')}</option>
        </select>
      </div>

      {/* Notifications */}
      <div className="space-y-5 pt-4 border-t border-border/50">
        <div>
          <Label className="text-base">{t('settings.notifications')}</Label>
          <p className="text-sm text-muted-foreground">{t('settings.notificationsDescription')}</p>
        </div>

        {notificationItems.map((item) => (
          <div key={item.key} className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 shrink-0 rounded-lg bg-accent flex items-center justify-center">
                <item.icon className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium">{item.title}</p>
                <p className="text-sm text-muted-foreground">{item.desc}</p>
              </div>
            </div>
            <Toggle
              checked={notificationPrefs[item.key]}
              onChange={(checked) =>
                setNotificationPrefs((prev) => ({ ...prev, [item.key]: checked }))
              }
              disabled={saving}
            />
          </div>
        ))}
      </div>

      <div className="flex justify-end pt-4 border-t border-border/50">
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Spinner size="sm" className="mr-2" />}
          {t('common.save')}
        </Button>
      </div>
    </div>
  )
}
