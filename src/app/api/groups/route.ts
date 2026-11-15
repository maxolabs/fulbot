import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { getT } from '@/i18n/server'
import type { Language } from '@/i18n/core'

// Slugs that collide with static routes under /groups (the group would be
// unreachable). The DB enforces 'new' too (00028).
const RESERVED_SLUGS = ['new']

function isValidTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

// Messages are per field so the form can show them next to the control.
function createGroupSchema(t: ReturnType<typeof getT>) {
  return z.object({
    name: z
      .string()
      .trim()
      .min(2, t('ui.screens.newGroup.nameTooShort'))
      .max(50, t('ui.screens.newGroup.nameTooLong')),
    slug: z
      .string()
      .min(2, t('ui.screens.newGroup.slugLength'))
      .max(30, t('ui.screens.newGroup.slugLength'))
      .regex(/^[a-z0-9-]+$/, t('ui.screens.newGroup.slugInvalid'))
      .refine((slug) => !RESERVED_SLUGS.includes(slug), t('ui.screens.newGroup.slugReserved')),
    description: z.string().max(200, t('ui.screens.newGroup.descriptionTooLong')).optional(),
    defaultMatchDay: z.number().int().min(0).max(6).optional(),
    defaultMatchTime: z.string().optional(),
    defaultMaxPlayers: z
      .number()
      .int(t('ui.screens.newGroup.maxPlayersRange'))
      .min(4, t('ui.screens.newGroup.maxPlayersRange'))
      .max(30, t('ui.screens.newGroup.maxPlayersRange'))
      .optional(),
    timezone: z
      .string()
      .refine(isValidTimezone, t('ui.lifecycle.invalidTimezone'))
      .optional(),
  })
}

export async function POST(request: NextRequest) {
  const language: Language = request.cookies.get('fulbot_lang')?.value === 'en' ? 'en' : 'es'
  const t = getT(language)

  try {
    const supabase = await createClient()

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: t('ui.screens.newGroup.unauthorized') }, { status: 401 })
    }

    // Parse and validate request body
    const body = await request.json()
    const validationResult = createGroupSchema(t).safeParse(body)

    if (!validationResult.success) {
      // First message per field, e.g. { slug: 'Esa URL está reservada…' }.
      const fieldErrors: Record<string, string> = {}
      for (const issue of validationResult.error.issues) {
        const field = String(issue.path[0] ?? '')
        if (field && !fieldErrors[field]) fieldErrors[field] = issue.message
      }
      return NextResponse.json(
        { error: t('ui.screens.newGroup.invalidData'), fieldErrors },
        { status: 400 }
      )
    }

    const { name, slug, description, defaultMatchDay, defaultMatchTime, defaultMaxPlayers, timezone } =
      validationResult.data

    // Create group with admin membership via RPC (bypasses RLS)
    const { data: group, error: groupError } = await supabase
      .rpc('create_group_with_admin', {
        p_name: name,
        p_slug: slug,
        p_description: description || undefined,
        p_default_match_day: defaultMatchDay ?? 1,
        p_default_match_time: defaultMatchTime || '21:00',
        p_default_max_players: defaultMaxPlayers || 14,
        p_timezone: timezone || undefined,
      })

    if (groupError) {
      // groups is readable by members only, so a slug taken by another group
      // only shows up as the unique violation on insert.
      if (groupError.code === '23505') {
        return NextResponse.json(
          { error: t('ui.screens.newGroup.slugTaken'), fieldErrors: { slug: t('ui.screens.newGroup.slugTaken') } },
          { status: 400 }
        )
      }
      // groups_slug_not_reserved (23514) and groups_validate_timezone (22023), 00028.
      if (groupError.code === '23514') {
        return NextResponse.json(
          { error: t('ui.screens.newGroup.slugReserved'), fieldErrors: { slug: t('ui.screens.newGroup.slugReserved') } },
          { status: 400 }
        )
      }
      if (groupError.code === '22023') {
        return NextResponse.json(
          { error: t('ui.lifecycle.invalidTimezone'), fieldErrors: { timezone: t('ui.lifecycle.invalidTimezone') } },
          { status: 400 }
        )
      }
      console.error('Error creating group:', groupError)
      return NextResponse.json(
        { error: t('ui.screens.newGroup.createError') },
        { status: 500 }
      )
    }

    return NextResponse.json({ group, slug: group.slug }, { status: 201 })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: t('ui.screens.newGroup.createError') },
      { status: 500 }
    )
  }
}
