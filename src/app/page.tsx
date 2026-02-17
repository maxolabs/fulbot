import Link from 'next/link'
import { Users, Brain, BarChart3, ChevronRight } from 'lucide-react'

export default function Home() {
  return (
    <main className="relative min-h-screen flex flex-col items-center justify-center p-4 overflow-hidden">
      {/* Background gradient effects */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-primary/5 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[400px] h-[400px] rounded-full bg-primary/3 blur-[100px]" />
      </div>

      <div className="relative max-w-lg w-full space-y-12">
        {/* Brand */}
        <div className="text-center space-y-4">
          <h1 className="text-5xl sm:text-6xl font-black tracking-tight">
            ful
            <span className="text-primary">bot</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-xs mx-auto">
            Organiza partidos de fútbol con tus amigos
          </p>
        </div>

        {/* Features */}
        <div className="space-y-3">
          {[
            {
              icon: Users,
              title: 'Inscripción rápida',
              desc: 'Compartí el link y que se anoten desde el celular',
            },
            {
              icon: Brain,
              title: 'Equipos con IA',
              desc: 'Genera equipos balanceados automáticamente',
            },
            {
              icon: BarChart3,
              title: 'Estadísticas',
              desc: 'Goles, asistencias, MVPs y más',
            },
          ].map((feature) => (
            <div
              key={feature.title}
              className="group flex items-center gap-4 rounded-2xl border border-border/50 bg-card/50 backdrop-blur-sm p-4 transition-colors hover:border-primary/30 hover:bg-card"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <feature.icon className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">{feature.title}</p>
                <p className="text-sm text-muted-foreground">{feature.desc}</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary/60 transition-colors" />
            </div>
          ))}
        </div>

        {/* CTA Buttons */}
        <div className="space-y-3">
          <Link
            href="/register"
            className="flex items-center justify-center rounded-2xl bg-primary px-6 py-3.5 text-sm font-bold text-primary-foreground transition-all hover:brightness-110 glow-sm hover:glow-md"
          >
            Crear cuenta
          </Link>
          <Link
            href="/login"
            className="flex items-center justify-center rounded-2xl border border-border/50 bg-card/50 backdrop-blur-sm px-6 py-3.5 text-sm font-medium text-foreground transition-colors hover:bg-card hover:border-border"
          >
            Iniciar sesión
          </Link>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground/60">
          Hecho para organizar partidos de fútbol amateur
        </p>
      </div>
    </main>
  )
}
