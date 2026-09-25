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

    // Create group with admin membership via RPC (bypasses RLS)
     
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
      // groups is readable by members only, so a slug taken by another group
      // only shows up as the unique violation on insert.
      if (groupError.code === '23505') {
        return NextResponse.json(
          { error: 'Esta URL ya está en uso. Elegí otra.' },
          { status: 400 }
        )
      }
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
