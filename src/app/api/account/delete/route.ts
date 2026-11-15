import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isLastAdminOfGroupError } from '@/lib/membership-errors'

// "Borrar mi cuenta" (OD-5). Two steps:
//   1. delete_my_account() as the signed-in user (00033): refuses while they
//      are the last admin of a group with other members, otherwise cancels
//      their upcoming signups without a cancel penalty, leaves their groups,
//      deletes solo groups, push subscriptions, authored peer ratings and
//      their notifications, and anonymizes the player profile ("Jugador
//      eliminado"), which stays for the match history.
//   2. Sign the session out and delete the auth user with the service role
//      (auth.admin.deleteUser); public.users goes with it (ON DELETE CASCADE).
// Step 1 is safe to repeat, so a failure in step 2 can simply be retried.
//
// Answers with error codes, never user-facing text: the settings row maps them.

export async function POST() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'not_authenticated' }, { status: 401 })
  }

  const { error: rpcError } = await supabase.rpc('delete_my_account')

  if (rpcError) {
    if (isLastAdminOfGroupError(rpcError)) {
      return NextResponse.json(
        { error: 'last_admin_of_group', groups: rpcError.details ?? '' },
        { status: 409 }
      )
    }
    console.error('delete_my_account failed:', rpcError.code ?? rpcError.message)
    return NextResponse.json({ error: 'delete_failed' }, { status: 500 })
  }

  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch (err) {
    console.error('account delete: service role client unavailable:', err)
    return NextResponse.json({ error: 'delete_failed' }, { status: 500 })
  }

  // Revoke every session first while the user still exists; this also clears
  // the session cookies on this response.
  const { error: signOutError } = await supabase.auth.signOut()
  if (signOutError) {
    console.error('account delete: sign out failed:', signOutError.code ?? signOutError.message)
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id)
  if (deleteError) {
    console.error('account delete: deleteUser failed:', deleteError.code ?? deleteError.message)
    return NextResponse.json({ error: 'delete_failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
