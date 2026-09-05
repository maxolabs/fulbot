'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, X, User, LogOut, Settings, Bell } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils/cn'
import { Avatar } from '@/components/ui/avatar'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { useT } from '@/i18n/provider'

interface HeaderProps {
  user?: {
    name: string
    email: string
    avatar_url?: string | null
  }
}

export function Header({ user }: HeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const t = useT()
  const [unreadCount, setUnreadCount] = useState(0)

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  // Fetch the unread notification count on mount and whenever the route
  // changes (e.g. after visiting /notifications and marking things read).
  useEffect(() => {
    if (!user) return
    let cancelled = false

    supabase
      .rpc('get_unread_notification_count')
      .then(({ data, error }) => {
        if (cancelled || error) return
        if (typeof data === 'number') setUnreadCount(data)
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, pathname])

  const navigation = [
    { name: t('nav.groups'), href: '/groups' },
  ]

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <Link href="/groups" className="flex items-center gap-2">
            <span className="text-xl font-black tracking-tight">
              ful<span className="text-primary">bot</span>
            </span>
          </Link>
        </div>

        {/* Desktop Navigation */}
        <div className="hidden md:flex md:items-center md:gap-6">
          {navigation.map((item) => (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'text-sm font-medium transition-colors hover:text-foreground',
                pathname.startsWith(item.href)
                  ? 'text-foreground'
                  : 'text-muted-foreground'
              )}
            >
              {item.name}
            </Link>
          ))}
        </div>

        {/* User Menu */}
        <div className="flex items-center gap-3">
          {user && (
            <Link
              href="/notifications"
              className="relative rounded-full p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Notificaciones"
            >
              <Bell className="h-5 w-5" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </Link>
          )}
          {user ? (
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="flex items-center gap-2 rounded-full focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
              >
                <Avatar
                  src={user.avatar_url}
                  fallback={user.name}
                  size="sm"
                />
              </button>

              {userMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setUserMenuOpen(false)}
                  />
                  <div className="absolute right-0 z-20 mt-2 w-56 rounded-xl bg-card border border-border/50 shadow-lg shadow-black/20">
                    <div className="px-4 py-3 border-b border-border/50">
                      <p className="text-sm font-medium">{user.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {user.email}
                      </p>
                    </div>
                    <div className="py-1">
                      <Link
                        href="/profile"
                        onClick={() => setUserMenuOpen(false)}
                        className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-accent rounded-lg mx-1 transition-colors"
                      >
                        <User className="h-4 w-4 text-muted-foreground" />
                        {t('nav.profile')}
                      </Link>
                      <Link
                        href="/settings"
                        onClick={() => setUserMenuOpen(false)}
                        className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-accent rounded-lg mx-1 transition-colors"
                      >
                        <Settings className="h-4 w-4 text-muted-foreground" />
                        {t('nav.settings')}
                      </Link>
                      <button
                        onClick={handleSignOut}
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-destructive hover:bg-accent rounded-lg mx-1 transition-colors"
                      >
                        <LogOut className="h-4 w-4" />
                        {t('nav.logout')}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : (
            <Link
              href="/login"
              className="rounded-xl border border-border/50 bg-card/50 px-4 py-2 text-sm font-medium transition-colors hover:bg-card hover:border-border"
            >
              {t('nav.login')}
            </Link>
          )}

          {/* Mobile menu button */}
          <button
            type="button"
            className="md:hidden rounded-lg p-2 hover:bg-accent transition-colors"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? (
              <X className="h-5 w-5" />
            ) : (
              <Menu className="h-5 w-5" />
            )}
          </button>
        </div>
      </nav>

      {/* Mobile Navigation */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-border/50">
          <div className="space-y-1 px-4 py-3">
            {navigation.map((item) => (
              <Link
                key={item.name}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={cn(
                  'block rounded-lg px-3 py-2.5 text-base font-medium transition-colors',
                  pathname.startsWith(item.href)
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-accent'
                )}
              >
                {item.name}
              </Link>
            ))}
          </div>
        </div>
      )}
    </header>
  )
}
