"use client";

import { useState, useEffect, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { queryClient } from "@/lib/query-client";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { TenantProvider } from "@/contexts/TenantContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { initWsStore } from "@/stores/websocket";
import { initTracing } from "@/telemetry/tracing";
import { usePersistentState } from "@/hooks/usePersistentState";
import { Toaster } from "@/components/ui/sonner";
import { Layout } from "@/components/layout/Layout";
import { CommandPalette } from "@/components/modals/CommandPalette";

/**
 * Inner shell rendered inside AuthProvider so it can call useAuth().
 * Blocks any protected page from mounting until auth state is hydrated
 * from localStorage, preventing unauthenticated API calls.
 */
function AppShell({ children }: { children: React.ReactNode }) {
  const { state: persistedState, isLoaded: persistedLoaded } =
    usePersistentState();
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const { user, isLoading: authLoading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const isLoginPage = pathname === "/login";

  // Theme toggle
  const toggleTheme = useCallback(() => {
    const newValue = persistedState.theme === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("light", newValue === "light");
    document.documentElement.classList.toggle("dark", newValue === "dark");
  }, [persistedState.theme]);

  // Initialize theme from persisted state
  useEffect(() => {
    if (!persistedLoaded) return;
    const isDark = persistedState.theme === "dark";
    document.documentElement.classList.toggle("light", !isDark);
    document.documentElement.classList.toggle("dark", isDark);
  }, [persistedLoaded, persistedState.theme]);

  // Initialize WebSocket and Tracing once
  useEffect(() => {
    initWsStore();
    initTracing();
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Redirect unauthenticated users to login (after auth hydration completes)
  useEffect(() => {
    if (!authLoading && !user && !isLoginPage) {
      router.replace("/login");
    }
  }, [authLoading, user, isLoginPage, router]);

  // While auth state is hydrating from localStorage, show nothing to avoid
  // mounting protected pages (and firing their queries) without a token.
  if (authLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <>
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
      />
      {isLoginPage ? (
        children
      ) : (
        <Layout
          isDark={persistedState.theme === "dark"}
          onToggleTheme={toggleTheme}
          onOpenCommandPalette={() => setCommandPaletteOpen(true)}
        >
          {children}
        </Layout>
      )}
      <Toaster
        position="bottom-right"
        toastOptions={{
          className: "bg-card border-border text-foreground",
        }}
      />
      <ReactQueryDevtools initialIsOpen={false} />
    </>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TenantProvider>
          <TooltipProvider delayDuration={200}>
            <AppShell>{children}</AppShell>
          </TooltipProvider>
        </TenantProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

