'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { PublicFrame } from '@/components/layout/public-frame'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils/cn'
import { useT } from '@/i18n/provider'

// Invite code entry (docs/ui-rework/03-screens.md §12): a dashed card with
// one mono input and one cone button.

// Players paste the whole WhatsApp link as often as the code: keep the last
// path segment (dropping any query or hash) and lowercase it, since invite
// codes are lowercase hex.
function normalizeInviteCode(raw: string): string {
  const withoutQuery = raw.trim().split(/[?#]/)[0]
  const segments = withoutQuery.split('/').filter(Boolean)
  return (segments[segments.length - 1] ?? '').trim().toLowerCase()
}

export default function InviteCodePage() {
  const t = useT()
  const [code, setCode] = useState('')
  const router = useRouter()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const normalized = normalizeInviteCode(code)
    if (normalized) {
      router.push(`/invite/${encodeURIComponent(normalized)}`)
    }
  }

  return (
    <PublicFrame width="sm" className="justify-center">
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-xl">{t('ui.screens.invite.enterTitle')}</CardTitle>
          <CardDescription>{t('ui.screens.invite.enterHint')}</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="code">{t('groups.inviteCode')}</Label>
              <Input
                id="code"
                placeholder="abc123def456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className="font-mono"
              />
            </div>
            <Button type="submit" size="xl" className="w-full" disabled={!code.trim()}>
              {t('common.next')}
            </Button>
            <div className="text-center">
              <Link href="/groups" className={cn(buttonVariants({ variant: 'link' }), 'text-muted-foreground hover:text-foreground')}>
                {t('ui.shell.myGroups')}
              </Link>
            </div>
          </CardContent>
        </form>
      </Card>
    </PublicFrame>
  )
}
