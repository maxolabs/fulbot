'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bell, BellOff, RotateCw, Smartphone } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { useT } from '@/i18n/provider'

type DeviceState = 'loading' | 'off' | 'on' | 'blocked' | 'install' | 'unsupported' | 'unconfigured'

function applicationKey(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const decoded = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
  return Uint8Array.from(decoded, (char) => char.charCodeAt(0))
}

export function DeviceNotifications() {
  const t = useT()
  const [state, setState] = useState<DeviceState>('loading')
  const [publicKey, setPublicKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  const inspect = useCallback(async (isCancelled: () => boolean = () => false) => {
    setLoadFailed(false)
    try {
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
      const standalone = window.matchMedia('(display-mode: standalone)').matches
        || (navigator as Navigator & { standalone?: boolean }).standalone
      let next: DeviceState = 'off'
      if (ios && !standalone) next = 'install'
      else if (!window.isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) next = 'unsupported'
      else if (Notification.permission === 'denied') next = 'blocked'
      else {
        const registration = await navigator.serviceWorker.register('/sw.js')
        const subscription = await registration.pushManager.getSubscription()
        const query = subscription ? `?endpoint=${encodeURIComponent(subscription.endpoint)}` : ''
        const response = await fetch(`/api/push/subscription${query}`, { cache: 'no-store' })
        if (!response.ok) throw new Error('Could not load device settings')
        const data = await response.json()
        // A browser subscription the server doesn't know for this account
        // (expired, or left by someone who signed out without the button)
        // must not keep receiving alerts.
        if (subscription && data.configured && !data.subscribed) await subscription.unsubscribe().catch(() => false)
        if (!isCancelled()) setPublicKey(data.publicKey || '')
        next = !data.configured ? 'unconfigured' : data.subscribed ? 'on' : 'off'
      }
      if (!isCancelled()) setState(next)
    } catch {
      if (!isCancelled()) { setState('off'); setLoadFailed(true) }
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    inspect(() => cancelled)
    // Coming back from the OS/browser settings after unblocking.
    const recheck = () => { if (document.visibilityState === 'visible') inspect(() => cancelled) }
    document.addEventListener('visibilitychange', recheck)
    return () => { cancelled = true; document.removeEventListener('visibilitychange', recheck) }
  }, [inspect])

  async function enable() {
    setBusy(true)
    setError(false)
    setDismissed(false)
    let subscription: PushSubscription | null = null
    let saved = false
    try {
      // Permission is requested directly from a tap, as required on iOS.
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'blocked' : 'off')
        setDismissed(permission !== 'denied')
        return
      }
      const registration = await navigator.serviceWorker.ready
      subscription = await registration.pushManager.getSubscription()
      if (subscription) await subscription.unsubscribe()
      subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationKey(publicKey) })
      const response = await fetch('/api/push/subscription', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(subscription),
      })
      if (!response.ok) throw new Error('Could not save subscription')
      saved = true
      setState('on')
    } catch {
      if (subscription && !saved) await subscription.unsubscribe().catch(() => false)
      setError(true)
    } finally { setBusy(false) }
  }

  async function disable() {
    setBusy(true)
    setError(false)
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        const response = await fetch('/api/push/subscription', {
          method: 'DELETE', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        })
        if (!response.ok) throw new Error('Could not remove subscription')
        await subscription.unsubscribe()
      }
      setState('off')
    } catch { setError(true) }
    finally { setBusy(false) }
  }

  if (state === 'unconfigured') return null

  const badge = state === 'on' ? { variant: 'success' as const, key: 'on' }
    : state === 'off' ? { variant: 'outline' as const, key: 'off' }
    : state === 'blocked' ? { variant: 'destructive' as const, key: 'blocked' }
    : state === 'loading' ? null
    : { variant: 'secondary' as const, key: 'unavailable' }
  const actionable = state === 'off' || state === 'on'

  return (
    <Card aria-busy={state === 'loading' || busy}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Smartphone className="h-5 w-5" aria-hidden="true" />{t('devicePush.title')}
          {badge && <Badge variant={badge.variant}>{t(`devicePush.badge.${badge.key}`)}</Badge>}
        </CardTitle>
        <CardDescription>{t('devicePush.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {state === 'off' && (
          <div className="rounded-md border border-border bg-secondary/50 p-3" aria-hidden="true">
            <p className="text-xs font-medium text-muted-foreground">fulbot</p>
            <p className="mt-1 text-sm font-semibold">{t('devicePush.previewTitle')}</p>
            <p className="text-xs text-muted-foreground">{t('devicePush.previewBody')}</p>
          </div>
        )}
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          {state === 'loading' && <Spinner size="sm" />}
          {t(`devicePush.${state}`)}
        </p>
        {dismissed && state === 'off' && <p className="text-sm text-muted-foreground">{t('devicePush.dismissed')}</p>}
        {(error || loadFailed) && <p role="alert" className="text-sm text-destructive">{t('devicePush.error')}</p>}
        {loadFailed ? (
          <Button type="button" variant="outline" onClick={() => inspect()}>
            <RotateCw className="h-4 w-4" aria-hidden="true" />{t('devicePush.retry')}
          </Button>
        ) : actionable && (
          <Button type="button" variant={state === 'on' ? 'outline' : 'default'} onClick={state === 'on' ? disable : enable} disabled={busy || (state === 'off' && !publicKey)}>
            {busy ? <Spinner size="sm" /> : state === 'on' ? <BellOff className="h-4 w-4" aria-hidden="true" /> : <Bell className="h-4 w-4" aria-hidden="true" />}
            {t(busy ? (state === 'on' ? 'devicePush.disabling' : 'devicePush.enabling') : state === 'on' ? 'devicePush.disable' : 'devicePush.enable')}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
