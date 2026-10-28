import type { Metadata } from "next"
import { Inter } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/layout/theme-provider"
import { WorkspaceProvider } from "@/components/providers/workspace-provider"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { AppHeader } from "@/components/layout/app-header"
import { SidebarProvider } from "@/components/layout/sidebar-provider"
import { WorkspaceDialogsProvider } from "@/components/features/workspace/workspace-dialogs"
import { Toaster } from "@/components/ui/sonner"
import { APP_VERSION } from "@/lib/app-version"
import { TooltipProvider } from "@/components/ui/tooltip"

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" })

export const metadata: Metadata = {
  title: "BlackAgents — AI Agent Toolkit",
  description:
    "Local-first manager for AI agents, commands, rules, and skills with an authoring-standards baseline and an Obsidian-style relationship graph.",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <WorkspaceProvider>
            <TooltipProvider delayDuration={200}>
              <WorkspaceDialogsProvider>
                <SidebarProvider>
                  <div className="flex h-screen overflow-hidden">
                    <AppSidebar version={APP_VERSION} />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <AppHeader />
                      <main className="flex-1 overflow-y-auto scrollbar-thin">
                        {children}
                      </main>
                    </div>
                  </div>
                </SidebarProvider>
              </WorkspaceDialogsProvider>
            </TooltipProvider>
          </WorkspaceProvider>
          <Toaster richColors position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  )
}
