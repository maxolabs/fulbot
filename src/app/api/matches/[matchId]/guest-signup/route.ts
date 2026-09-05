import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database'

interface RouteContext {
  params: Promise<{ matchId: string }>
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function guestCookieName(matchId: string) {
  return `fulbot_guest_${matchId}`
}

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

// The only caller of public_guest_signup: creates/updates the guest signup
// and hands the browser an httpOnly cookie carrying the guest's token, so a
// future visit (or a cancel) can prove ownership without an account.
export async function POST(request: NextRequest, context: RouteContext) {
  const { matchId } = await context.params

  let body: { displayName?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 })
  }

  const displayName = (body.displayName || '').trim()
  if (!displayName) {
    return NextResponse.json({ error: 'Ingresá tu nombre' }, { status: 400 })
  }

  const existingToken = request.cookies.get(guestCookieName(matchId))?.value
  const token = existingToken && UUID_RE.test(existingToken) ? existingToken : randomUUID()

  const supabase = createAdminClient()
  const args: Database['public']['Functions']['public_guest_signup']['Args'] = {
    p_match_id: matchId,
    p_display_name: displayName,
    p_token: token,
  }
  const { data, error } = await (supabase as any).rpc('public_guest_signup', args)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  const response = NextResponse.json(data)
  response.cookies.set(guestCookieName(matchId), token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ONE_YEAR_SECONDS,
  })
  return response
}

// The only caller of cancel_guest_signup: reads the guest's token from the
// cookie set above (never trusts a client-supplied token) and clears it.
export async function DELETE(request: NextRequest, context: RouteContext) {
  const { matchId } = await context.params
  const token = request.cookies.get(guestCookieName(matchId))?.value

  if (!token) {
    return NextResponse.json({ error: 'No hay una inscripción de invitado para bajar' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const args: Database['public']['Functions']['cancel_guest_signup']['Args'] = {
    p_match_id: matchId,
    p_token: token,
  }
  const { error } = await (supabase as any).rpc('cancel_guest_signup', args)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  const response = NextResponse.json({ ok: true })
  response.cookies.set(guestCookieName(matchId), '', { path: '/', maxAge: 0 })
  return response
}
