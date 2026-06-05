import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { AppSidebar } from "./AppSidebar";
import { Header } from "./Header";
import { Breadcrumbs } from "./Breadcrumbs";
import { Toaster } from "../ui/sonner";

interface LayoutProps {
  children: React.ReactNode;
  isDark: boolean;
  onToggleTheme: () => void;
  onOpenCommandPalette: () => void;
}

export function Layout({
  children,
  isDark,
  onToggleTheme,
  onOpenCommandPalette,
}: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/login");
    }
  }, [user, isLoading, router]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
      />

      <div
        className="transition-all duration-300"
        style={{ marginLeft: sidebarOpen ? "16rem" : "5rem" }}
      >
        <Header
          isDark={isDark}
          onToggleTheme={onToggleTheme}
          onOpenCommandPalette={onOpenCommandPalette}
        />

        <Breadcrumbs />

        <main className="bg-grid min-h-[calc(100vh-8rem)]">
          <div className="p-6">{children}</div>
        </main>
      </div>

      <Toaster
        position="bottom-right"
        toastOptions={{
          className: "bg-card border-border text-foreground",
        }}
      />
    </div>
  );
}
