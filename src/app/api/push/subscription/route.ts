import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAllowedPushEndpoint } from '@/lib/notifications/push-payload'
import { pushConfiguration } from '@/lib/notifications/push'

export const dynamic = 'force-dynamic'

const MAX_DEVICES_PER_USER = 10
const endpointSchema = z.string().max(2048).refine(isAllowedPushEndpoint)
const subscriptionSchema = z.object({
  endpoint: endpointSchema,
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}=?$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}(==)?$/),
  }),
})

export async function GET(request: NextRequest) {
  const db = await createClient()
  const { data: { user } } = await db.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const endpoint = request.nextUrl.searchParams.get('endpoint')
  const config = pushConfiguration()
  if (!endpoint) return NextResponse.json({ configured: Boolean(config), publicKey: config?.publicKey }, { headers: { 'Cache-Control': 'no-store' } })
  if (!endpointSchema.safeParse(endpoint).success) return NextResponse.json({ error: 'Invalid endpoint' }, { status: 400 })
  const { data, error } = await db.from('push_subscriptions').select('id').eq('endpoint', endpoint).eq('user_id', user.id).maybeSingle()
  if (error) return NextResponse.json({ error: 'Subscriptions unavailable' }, { status: 503 })
  return NextResponse.json({ subscribed: Boolean(data), configured: Boolean(config), publicKey: config?.publicKey }, { headers: { 'Cache-Control': 'no-store' } })
}

async function mutate(request: NextRequest, remove: boolean) {
  if (request.headers.get('origin') !== request.nextUrl.origin) {
    return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
  }
  const db = await createClient()
  const { data: { user } } = await db.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!remove && !pushConfiguration()) return NextResponse.json({ error: 'Push is not configured' }, { status: 503 })
  const body = await request.json().catch(() => null)
  if (remove) {
    const parsed = z.object({ endpoint: endpointSchema }).safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 })
    const { error } = await db.from('push_subscriptions').delete().eq('user_id', user.id).eq('endpoint', parsed.data.endpoint)
    if (error) return NextResponse.json({ error: 'Could not remove subscription' }, { status: 500 })
  } else {
    const parsed = subscriptionSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 })
    const { endpoint, keys } = parsed.data
    // Inserts bypass RLS (clients only read/delete) so the endpoint and keys
    // above are always validated. Upserting by endpoint also hands a shared
    // browser over to whoever enabled alerts on it last.
    const admin = createAdminClient()
    const { count } = await admin.from('push_subscriptions').select('id', { count: 'exact', head: true }).eq('user_id', user.id).neq('endpoint', endpoint)
    if ((count ?? 0) >= MAX_DEVICES_PER_USER) return NextResponse.json({ error: 'Too many devices' }, { status: 409 })
    const { error } = await admin.from('push_subscriptions').upsert({ user_id: user.id, endpoint, ...keys }, { onConflict: 'endpoint' })
    if (error) return NextResponse.json({ error: 'Could not save subscription' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}

export async function POST(request: NextRequest) { return mutate(request, false) }
export async function DELETE(request: NextRequest) { return mutate(request, true) }
