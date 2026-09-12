import { PublicFrame } from '@/components/layout/public-frame'

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <PublicFrame width="sm" className="items-center justify-center">
      {children}
    </PublicFrame>
  )
}
