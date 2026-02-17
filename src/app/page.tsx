import Link from 'next/link'

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 bg-gradient-to-b from-background to-secondary/20">
      <div className="max-w-md w-full text-center space-y-8">
        {/* Logo/Brand */}
        <div className="space-y-2">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-primary text-primary-foreground text-4xl font-bold">
            F
          </div>
          <h1 className="text-4xl font-bold tracking-tight">FUTBOT</h1>
          <p className="text-muted-foreground">
            Organiza partidos de fútbol con tus amigos
          </p>
        </div>

        {/* Features */}
        <div className="grid gap-4 text-left">
          <div className="flex items-start gap-3 p-4 rounded-lg bg-card border">
            <span className="text-2xl">📋</span>
            <div>
              <h3 className="font-semibold">Lista de inscripción</h3>
              <p className="text-sm text-muted-foreground">
                Comparte el link y deja que se anoten fácil desde el celular
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-4 rounded-lg bg-card border">
            <span className="text-2xl">🤖</span>
            <div>
              <h3 className="font-semibold">Equipos con IA</h3>
              <p className="text-sm text-muted-foreground">
                Genera equipos balanceados automáticamente
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-4 rounded-lg bg-card border">
            <span className="text-2xl">📊</span>
            <div>
              <h3 className="font-semibold">Estadísticas</h3>
              <p className="text-sm text-muted-foreground">
                Lleva el historial de partidos, goles y MVPs
              </p>
            </div>
          </div>
        </div>

        {/* CTA Buttons */}
        <div className="flex flex-col gap-3">
          <Link
            href="/register"
            className="inline-flex items-center justify-center rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Crear cuenta
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-lg border bg-background px-6 py-3 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            Iniciar sesión
          </Link>
        </div>

        {/* Footer */}
        <p className="text-xs text-muted-foreground">
          Hecho para organizar partidos de fútbol amateur
        </p>
      </div>
    </main>
  )
}
