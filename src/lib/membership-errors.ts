// Error codes raised by the membership and account RPCs (00033). The SQL raises
// a stable code as the message and a Spanish DETAIL; the app maps the code to
// a translated message and never shows the raw text.

interface RpcErrorLike {
  message?: string
  details?: string | null
}

function errorText(err: unknown): string {
  const e = err as RpcErrorLike | null
  return `${e?.message ?? ''} ${e?.details ?? ''}`
}

/** join_group_via_invite refused an admin-removed player (OD-1). */
export function isRemovedByAdminError(err: unknown): boolean {
  return errorText(err).includes('removed_by_admin')
}

/** delete_my_account refused the last admin of a group with other members. */
export function isLastAdminOfGroupError(err: unknown): boolean {
  return errorText(err).includes('last_admin_of_group')
}
