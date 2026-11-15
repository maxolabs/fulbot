'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CircleAlert } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { FormNotice, NativeSelect } from '@/components/form-controls'
import { PageHeader } from '@/components/layout/page-header'
import { useTopBar } from '@/components/layout/top-bar'
import { useT } from '@/i18n/provider'
import { TimezoneSelect, isValidTimezone } from '../[groupSlug]/settings/timezone-select'

// Create group (docs/ui-rework/03-screens.md §6 pattern): one-column form
// max-w-xl, submit at the end (the tab bar hides itself on /new).

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const
const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires'
// /groups/new is this page; a group with that slug could never be opened.
const RESERVED_SLUGS = ['new']

type Field = 'name' | 'slug' | 'description' | 'defaultMaxPlayers' | 'timezone'

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
    .replace(/\s+/g, '-') // Replace spaces with -
    .replace(/-+/g, '-') // Replace multiple - with single -
    .trim()
    .slice(0, 30) // The API caps slugs at 30
}

// Leading/trailing hyphens are fine while typing; trim them from the value sent.
function finalSlug(slug: string): string {
  return slug.replace(/^-+|-+$/g, '')
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <p id={id} className="flex items-center gap-1.5 text-sm text-destructive">
      <CircleAlert className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      {message}
    </p>
  )
}

export default function NewGroupPage() {
  const t = useT()
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({})

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false)
  const [description, setDescription] = useState('')
  const [defaultMatchDay, setDefaultMatchDay] = useState(1) // Monday
  const [defaultMatchTime, setDefaultMatchTime] = useState('21:00')
  const [defaultMaxPlayers, setDefaultMaxPlayers] = useState(14)
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE)
  const [browserTimezone, setBrowserTimezone] = useState<string | null>(null)

  // Default to the browser's zone. Read after mount: the server render has no
  // browser zone, so reading it during render would not hydrate.
  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      if (tz && isValidTimezone(tz)) {
        setBrowserTimezone(tz)
        setTimezone(tz)
      }
    } catch {
      // keep the default
    }
  }, [])

  useTopBar({ title: t('groups.create'), back: '/groups' })

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value
    setName(newName)
    if (!slugManuallyEdited) {
      setSlug(finalSlug(slugify(newName)))
    }
    setFieldErrors(prev => ({ ...prev, name: undefined, slug: slugManuallyEdited ? prev.slug : undefined }))
  }

  const handleSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSlugManuallyEdited(true)
    setSlug(slugify(e.target.value))
    setFieldErrors(prev => ({ ...prev, slug: undefined }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setFieldErrors({})

    const sentSlug = finalSlug(slug)
    const localErrors: Partial<Record<Field, string>> = {}
    if (sentSlug.length < 2) localErrors.slug = t('ui.screens.newGroup.slugLength')
    else if (RESERVED_SLUGS.includes(sentSlug)) localErrors.slug = t('ui.screens.newGroup.slugReserved')
    if (!isValidTimezone(timezone)) localErrors.timezone = t('ui.lifecycle.invalidTimezone')
    if (Object.keys(localErrors).length > 0) {
      setFieldErrors(localErrors)
      return
    }

    setLoading(true)

    try {
      const response = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          slug: sentSlug,
          description: description || undefined,
          defaultMatchDay,
          defaultMatchTime,
          defaultMaxPlayers,
          timezone,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        const serverFieldErrors = (data.fieldErrors ?? {}) as Partial<Record<Field, string>>
        if (Object.keys(serverFieldErrors).length > 0) {
          setFieldErrors(serverFieldErrors)
        } else {
          setError(data.error || t('ui.screens.newGroup.createError'))
        }
        return
      }

      router.push(`/groups/${data.slug}`)
      router.refresh()
    } catch {
      setError(t('ui.screens.newGroup.networkError'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <PageHeader title={t('groups.create')} subtitle={t('ui.screens.newGroup.subtitle')} />

      <Card>
        {/* Mobile: the top bar already says "Crear grupo" (02-shell §2), so the
            card only repeats the subtitle. */}
        <CardHeader className="lg:hidden">
          <CardDescription>{t('ui.screens.newGroup.subtitle')}</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-6 lg:pt-5">
            {error && <FormNotice kind="error">{error}</FormNotice>}

            <div className="space-y-1.5">
              <Label htmlFor="name">{t('groups.name')}</Label>
              <Input
                id="name"
                placeholder={t('ui.screens.newGroup.namePlaceholder')}
                value={name}
                onChange={handleNameChange}
                required
                disabled={loading}
                maxLength={50}
                aria-invalid={!!fieldErrors.name}
                aria-describedby={fieldErrors.name ? 'name-error' : undefined}
              />
              <FieldError id="name-error" message={fieldErrors.name} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="slug">{t('groups.slug')}</Label>
              <div className="flex items-center gap-2">
                <span className="shrink-0 font-mono text-xs text-muted-foreground">/groups/</span>
                <Input
                  id="slug"
                  placeholder="futbol-lunes"
                  value={slug}
                  onChange={handleSlugChange}
                  required
                  disabled={loading}
                  maxLength={30}
                  className="flex-1 font-mono"
                  aria-invalid={!!fieldErrors.slug}
                  aria-describedby={fieldErrors.slug ? 'slug-error' : undefined}
                />
              </div>
              <FieldError id="slug-error" message={fieldErrors.slug} />
              <p className="text-xs text-muted-foreground">{t('ui.screens.newGroup.slugHint')}</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="description">{t('ui.screens.newGroup.description')}</Label>
              <Input
                id="description"
                placeholder={t('ui.screens.newGroup.descriptionPlaceholder')}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={loading}
                maxLength={200}
                aria-invalid={!!fieldErrors.description}
                aria-describedby={fieldErrors.description ? 'description-error' : undefined}
              />
              <FieldError id="description-error" message={fieldErrors.description} />
            </div>

            <div className="space-y-4 border-t border-border pt-6">
              <h3 className="font-display text-base font-bold">{t('ui.screens.newGroup.defaults')}</h3>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="defaultMatchDay">{t('groups.defaultDay')}</Label>
                  <NativeSelect
                    id="defaultMatchDay"
                    value={defaultMatchDay}
                    onChange={(e) => setDefaultMatchDay(Number(e.target.value))}
                    disabled={loading}
                  >
                    {DAY_KEYS.map((key, value) => (
                      <option key={key} value={value}>
                        {t(`days.${key}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="defaultMatchTime">{t('groups.defaultTime')}</Label>
                  <Input
                    id="defaultMatchTime"
                    type="time"
                    value={defaultMatchTime}
                    onChange={(e) => setDefaultMatchTime(e.target.value)}
                    disabled={loading}
                    className="font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="defaultMaxPlayers">{t('groups.maxPlayers')}</Label>
                  <Input
                    id="defaultMaxPlayers"
                    type="number"
                    min={4}
                    max={30}
                    value={defaultMaxPlayers}
                    onChange={(e) => setDefaultMaxPlayers(Number(e.target.value))}
                    disabled={loading}
                    className="font-mono"
                    aria-invalid={!!fieldErrors.defaultMaxPlayers}
                    aria-describedby={fieldErrors.defaultMaxPlayers ? 'max-players-error' : undefined}
                  />
                  <FieldError id="max-players-error" message={fieldErrors.defaultMaxPlayers} />
                  <p className="text-xs text-muted-foreground">{t('ui.screens.newGroup.maxPlayersHint')}</p>
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="timezone">{t('ui.screens.newGroup.timezone')}</Label>
                  <TimezoneSelect
                    id="timezone"
                    value={timezone}
                    onChange={(tz) => {
                      setTimezone(tz)
                      setFieldErrors(prev => ({ ...prev, timezone: undefined }))
                    }}
                    disabled={loading}
                    extraOption={browserTimezone}
                  />
                  <FieldError id="timezone-error" message={fieldErrors.timezone} />
                  <p className="text-xs text-muted-foreground">{t('ui.screens.newGroup.timezoneHint')}</p>
                </div>
              </div>
            </div>

            <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row">
              <Link href="/groups" className={buttonVariants({ variant: 'outline' })}>
                {t('common.cancel')}
              </Link>
              <Button type="submit" disabled={loading || !name || !slug} className="sm:flex-1">
                {loading && <Spinner size="sm" />}
                {t('groups.create')}
              </Button>
            </div>
          </CardContent>
        </form>
      </Card>
    </div>
  )
}
