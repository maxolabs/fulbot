import Link from 'next/link'

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="relative min-h-screen flex flex-col overflow-hidden">
      {/* Background gradient */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[500px] h-[500px] rounded-full bg-primary/5 blur-[120px]" />
      </div>

      {/* Header */}
      <header className="relative border-b border-border/50">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <Link href="/" className="inline-flex items-center gap-2">
            <span className="text-xl font-black tracking-tight">
              ful<span className="text-primary">bot</span>
            </span>
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="relative flex-1 flex items-center justify-center p-4">
        {children}
      </main>

      {/* Footer */}
      <footer className="relative border-t border-border/50 py-4 text-center text-xs text-muted-foreground/60">
        <p>Hecho para organizar partidos de fútbol amateur</p>
      </footer>
    </div>
  )
}
