'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, Users, Trophy, CalendarClock, ClipboardList, AlarmClock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Eyebrow } from '@/components/ui/eyebrow'
import { Label } from '@/components/ui/label'
import { Segmented } from '@/components/ui/segmented'
import { Spinner } from '@/components/ui/spinner'
import { FormNotice, NativeSelect, Toggle } from '@/components/form-controls'
import { useT } from '@/i18n/provider'
import type { Language } from '@/i18n/use-translations'
import { saveSettings, type ThemePreference, type NotificationPrefsInput } from './actions'

// Preferences (docs/ui-rework/03-screens.md §10): language, theme as a
// segmented control (Papel / Pizarra / Sistema) and the notification
// toggles. The theme preview and the cookie write are unchanged: the class
// on <html> flips immediately, the cookie is set by the server action.

interface SettingsFormProps {
  initialLanguage: Language
  initialTheme: ThemePreference
  initialNotificationPrefs: NotificationPrefsInput
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

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
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
    {
      key: 'results_request',
      icon: ClipboardList,
      title: t('settings.notifResultsRequestTitle'),
      desc: t('settings.notifResultsRequestDesc'),
    },
    {
      key: 'results_reminder',
      icon: AlarmClock,
      title: t('settings.notifResultsReminderTitle'),
      desc: t('settings.notifResultsReminderDesc'),
    },
  ]

  return (
    <form onSubmit={handleSave} className="space-y-6">
      {error && <FormNotice kind="error">{error}</FormNotice>}
      {success && <FormNotice kind="success">{t('settings.saved')}</FormNotice>}

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.language')}</CardTitle>
          <CardDescription>{t('settings.languageDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <Label htmlFor="language">{t('settings.language')}</Label>
          <NativeSelect
            id="language"
            value={language}
            onChange={(e) => setLanguage(e.target.value as Language)}
            disabled={saving}
            wrapperClassName="sm:max-w-xs"
          >
            <option value="es">{t('auth.languageEs')}</option>
            <option value="en">{t('auth.languageEn')}</option>
          </NativeSelect>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.theme')}</CardTitle>
          <CardDescription>{t('settings.themeDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <Eyebrow id="theme-label" as="span" className="block">
            {t('settings.theme')}
          </Eyebrow>
          <Segmented<ThemePreference>
            aria-labelledby="theme-label"
            value={theme}
            onChange={handleThemeChange}
            className="w-full sm:w-auto"
            options={[
              { value: 'light', label: t('ui.screens.preferences.themePaper') },
              { value: 'dark', label: t('ui.screens.preferences.themeBoard') },
              { value: 'system', label: t('ui.screens.preferences.themeSystem') },
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.notifications')}</CardTitle>
          <CardDescription>{t('settings.notificationsDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="[&>li:last-child]:border-b-0">
            {notificationItems.map((item) => {
              const id = `pref-${item.key}`
              return (
                <li key={item.key} className="flex items-center justify-between gap-4 border-b border-border py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-secondary">
                      <item.icon className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <p id={id} className="text-sm font-medium">{item.title}</p>
                      <p className="text-xs text-muted-foreground">{item.desc}</p>
                    </div>
                  </div>
                  <Toggle
                    aria-labelledby={id}
                    checked={notificationPrefs[item.key]}
                    onChange={(checked) =>
                      setNotificationPrefs((prev) => ({ ...prev, [item.key]: checked }))
                    }
                    disabled={saving}
                  />
                </li>
              )
            })}
          </ul>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={saving} className="w-full sm:w-auto">
          {saving && <Spinner size="sm" />}
          {t('common.save')}
        </Button>
      </div>
    </form>
  )
}
