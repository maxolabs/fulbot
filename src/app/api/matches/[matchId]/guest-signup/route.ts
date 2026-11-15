import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database'
import { getT } from '@/i18n/server'
import type { Language } from '@/i18n/core'

interface RouteContext {
  params: Promise<{ matchId: string }>
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function guestCookieName(matchId: string) {
  return `fulbot_guest_${matchId}`
}

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365
const MAX_NAME_LENGTH = 60 // same cap as public_guest_signup (00025)

// The RPCs raise Spanish messages; the client gets a translated one for the
// cases a guest can act on and a generic one otherwise, never the raw
// Postgres text.
const RPC_ERRORS: Array<[string, string]> = [
  ['El nombre no puede estar vacío', 'nameRequired'],
  ['El nombre es demasiado largo', 'nameTooLong'],
  ['Partido no encontrado', 'matchNotFound'],
  ['El partido no está aceptando inscripciones', 'closed'],
  ['El partido ya empezó', 'started'],
  ['El partido ya no admite cambios en la lista', 'locked'],
  ['Ya estás inscripto en este partido', 'alreadySignedUp'],
  ['Demasiadas inscripciones de invitados', 'rateLimited'],
  ['Inscripción no encontrada', 'signupNotFound'],
]

function translator(request: NextRequest) {
  const language: Language = request.cookies.get('fulbot_lang')?.value === 'en' ? 'en' : 'es'
  const t = getT(language)
  return (key: string) => t(`ui.lifecycle.guestErrors.${key}`)
}

function rpcErrorKey(message: string | undefined, fallback: string) {
  const hit = RPC_ERRORS.find(([needle]) => message?.includes(needle))
  return hit ? hit[1] : fallback
}

// The only caller of public_guest_signup: creates/updates the guest signup
// and hands the browser an httpOnly cookie carrying the guest's token, so a
// future visit (or a cancel) can prove ownership without an account.
export async function POST(request: NextRequest, context: RouteContext) {
  const { matchId } = await context.params
  const te = translator(request)

  let body: { displayName?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: te('invalidRequest') }, { status: 400 })
  }

  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : ''
  if (!displayName) {
    return NextResponse.json({ error: te('nameRequired') }, { status: 400 })
  }
  if (displayName.length > MAX_NAME_LENGTH) {
    return NextResponse.json({ error: te('nameTooLong') }, { status: 400 })
  }

  const existingToken = request.cookies.get(guestCookieName(matchId))?.value
  const token = existingToken && UUID_RE.test(existingToken) ? existingToken : randomUUID()

  const supabase = createAdminClient()
  const args: Database['public']['Functions']['public_guest_signup']['Args'] = {
    p_match_id: matchId,
    p_display_name: displayName,
    p_token: token,
  }
  const { data, error } = await supabase.rpc('public_guest_signup', args)

  if (error) {
    const key = rpcErrorKey(error.message, 'signupFailed')
    if (key === 'signupFailed') console.error('public_guest_signup failed:', error)
    return NextResponse.json({ error: te(key) }, { status: key === 'rateLimited' ? 429 : 400 })
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
  const te = translator(request)
  const token = request.cookies.get(guestCookieName(matchId))?.value

  if (!token || !UUID_RE.test(token)) {
    return NextResponse.json({ error: te('noGuestSignup') }, { status: 400 })
  }

  const supabase = createAdminClient()
  const args: Database['public']['Functions']['cancel_guest_signup']['Args'] = {
    p_match_id: matchId,
    p_token: token,
  }
  const { error } = await supabase.rpc('cancel_guest_signup', args)

  if (error) {
    const key = rpcErrorKey(error.message, 'cancelFailed')
    if (key === 'cancelFailed') console.error('cancel_guest_signup failed:', error)
    return NextResponse.json({ error: te(key) }, { status: 400 })
  }

  const response = NextResponse.json({ ok: true })
  response.cookies.set(guestCookieName(matchId), '', { path: '/', maxAge: 0 })
  return response
}
