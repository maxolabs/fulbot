export async function disableDevicePush() {
  if (!('serviceWorker' in navigator)) return
  const registration = await navigator.serviceWorker.getRegistration('/')
  const subscription = await registration?.pushManager?.getSubscription()
  if (!subscription) return
  const endpoint = subscription.endpoint
  // Invalidate the browser endpoint even if the server cannot be reached.
  await Promise.allSettled([subscription.unsubscribe(), fetch('/api/push/subscription', {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }), signal: AbortSignal.timeout(5000),
  })])
}
