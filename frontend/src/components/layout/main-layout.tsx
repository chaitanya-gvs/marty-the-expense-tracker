"use client";

import { Navigation } from "./navigation";
import { MobileNav } from "./mobile-nav";
import { useIsMobile } from "@/hooks/use-is-mobile";

interface MainLayoutProps {
  children: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <div className="relative flex flex-col min-h-screen bg-background">
        <main className="flex-1 overflow-auto pb-16">
          <div className="p-4">
            {children}
          </div>
        </main>
        <MobileNav />
      </div>
    );
  }

  return (
    <div className="relative flex h-screen bg-background">
      <div className="w-14 shrink-0" />
      <main className="flex-1 overflow-auto">
        <div className="p-6">
          {children}
        </div>
      </main>
      <Navigation />
    </div>
  );
}
