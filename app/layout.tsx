import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ThemeProvider } from '@/components/layout/theme-provider'
import './globals.css'

/**
 * Typography. Inter for UI, JetBrains Mono for money: both ship genuine tabular
 * figures, which is what keeps a column of pesos aligned in a grid that is meant
 * to read like a worksheet. Both are self-hosted by next/font — no FOUT, no
 * external request.
 */
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'], variable: '--font-jetbrains-mono', display: 'swap',
})

export const metadata: Metadata = {
  title: 'TRACKS — Annual Investment Program',
  description:
    'Annual Investment Program tracking for local government units: PPA encoding, '
    + 'consolidation, budget allotment, obligations, disbursements and monitoring.',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning
          className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="min-h-svh bg-background font-sans antialiased">
        <ThemeProvider>
          <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
          <Toaster richColors position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  )
}
