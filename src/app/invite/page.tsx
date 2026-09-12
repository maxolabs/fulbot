'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Users } from 'lucide-react'
import { PublicFrame } from '@/components/layout/public-frame'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function InviteCodePage() {
  const [code, setCode] = useState('')
  const router = useRouter()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (code.trim()) {
      router.push(`/invite/${code.trim()}`)
    }
  }

  return (
    <PublicFrame className="justify-center">
        <Card className="w-full">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <Users className="h-6 w-6 text-primary" />
            </div>
            <CardTitle>Unirse a un grupo</CardTitle>
            <CardDescription>
              Ingresa el código de invitación que te compartieron
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="code">Código de invitación</Label>
                <Input
                  id="code"
                  placeholder="abc123def456"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={!code.trim()}>
                Continuar
              </Button>
              <div className="text-center">
                <Link
                  href="/groups"
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="inline h-4 w-4 mr-1" />
                  Volver a mis grupos
                </Link>
              </div>
            </CardContent>
          </form>
        </Card>
    </PublicFrame>
  )
}
