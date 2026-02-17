import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const createGroupSchema = z.object({
  name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres').max(50),
  slug: z
    .string()
    .min(2)
    .max(30)
    .regex(/^[a-z0-9-]+$/, 'Solo letras minúsculas, números y guiones'),
  description: z.string().max(200).optional(),
  defaultMatchDay: z.number().min(0).max(6).optional(),
  defaultMatchTime: z.string().optional(),
  defaultMaxPlayers: z.number().min(4).max(30).optional(),
})

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    // Parse and validate request body
    const body = await request.json()
    const validationResult = createGroupSchema.safeParse(body)

    if (!validationResult.success) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: validationResult.error.flatten() },
        { status: 400 }
      )
    }

    const { name, slug, description, defaultMatchDay, defaultMatchTime, defaultMaxPlayers } =
      validationResult.data

    // Check if slug is already taken
    const { data: existingGroup } = await supabase
      .from('groups')
      .select('id')
      .eq('slug', slug)
      .single()

    if (existingGroup) {
      return NextResponse.json(
        { error: 'Este URL ya está en uso. Elige otro.' },
        { status: 400 }
      )
    }

    // Create group with admin membership via RPC (bypasses RLS)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: group, error: groupError } = await (supabase as any)
      .rpc('create_group_with_admin', {
        p_name: name,
        p_slug: slug,
        p_description: description || null,
        p_default_match_day: defaultMatchDay ?? 1,
        p_default_match_time: defaultMatchTime || '21:00',
        p_default_max_players: defaultMaxPlayers || 14,
      })

    if (groupError) {
      console.error('Error creating group:', groupError)
      return NextResponse.json(
        { error: 'Error al crear el grupo' },
        { status: 500 }
      )
    }

    return NextResponse.json({ group, slug: group.slug }, { status: 201 })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}

export async function GET() {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    // Get user's player profile
    const { data: playerProfile } = (await supabase
      .from('player_profiles')
      .select('id')
      .eq('user_id', user.id)
      .single()) as { data: { id: string } | null }

    if (!playerProfile) {
      return NextResponse.json({ groups: [] })
    }

    // Get user's groups
    type MembershipWithGroup = {
      role: string
      groups: {
        id: string
        name: string
        slug: string
        description: string | null
        default_match_day: number | null
        default_match_time: string | null
        default_max_players: number
        invite_code: string
      } | null
    }

    const { data: memberships } = await supabase
      .from('group_memberships')
      .select(
        `
        role,
        groups (
          id,
          name,
          slug,
          description,
          default_match_day,
          default_match_time,
          default_max_players,
          invite_code
        )
      `
      )
      .eq('player_id', playerProfile.id)
      .eq('is_active', true) as { data: MembershipWithGroup[] | null }

    const groups =
      memberships
        ?.filter((m) => m.groups !== null)
        .map((m) => ({
          ...(m.groups as Record<string, unknown>),
          role: m.role,
        })) || []

    return NextResponse.json({ groups })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}
