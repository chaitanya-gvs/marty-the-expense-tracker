"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  ArrowLeftRight,
  TrendingUp,
  Target,
  ScanSearch,
  HandCoins,
  SlidersHorizontal,
  MoreHorizontal,
  LogOut,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

// Direct tabs, one tap each — the 4 sections used most often day-to-day.
const primaryTabs = [
  { name: "Transactions", href: "/transactions", icon: ArrowLeftRight },
  { name: "Analytics", href: "/analytics", icon: TrendingUp },
  { name: "Budgets", href: "/budgets", icon: Target },
  { name: "Review", href: "/review", icon: ScanSearch },
];

// Tucked under "More" — reached in 2 taps instead of 1.
const moreItems = [
  { name: "Settlements", href: "/settlements", icon: HandCoins },
  { name: "Settings", href: "/settings", icon: SlidersHorizontal },
];

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

export function MobileNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [isMoreOpen, setIsMoreOpen] = useState(false);

  const handleLogout = async () => {
    await fetch(`${API_BASE}/auth/logout`, { method: "POST", credentials: "include" });
    router.replace("/login");
  };

  const isMoreActive = moreItems.some((item) => pathname === item.href);

  return (
    <>
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 flex items-stretch justify-around bg-sidebar border-t border-sidebar-border h-14"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {primaryTabs.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors",
                isActive ? "text-primary" : "text-muted-foreground"
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.name}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setIsMoreOpen(true)}
          className={cn(
            "flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors",
            isMoreActive ? "text-primary" : "text-muted-foreground"
          )}
        >
          <MoreHorizontal className="h-5 w-5" />
          More
        </button>
      </nav>

      <Sheet open={isMoreOpen} onOpenChange={setIsMoreOpen}>
        <SheetContent side="bottom" className="w-full sm:max-w-full rounded-t-xl">
          <SheetHeader>
            <SheetTitle>More</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-1 mt-2">
            {moreItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={() => setIsMoreOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary/15 text-primary"
                      : "text-foreground hover:bg-sidebar-accent"
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.name}
                </Link>
              );
            })}
            <button
              onClick={handleLogout}
              className="flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium text-muted-foreground hover:bg-sidebar-accent hover:text-destructive transition-colors"
            >
              <LogOut className="h-4 w-4" />
              Logout
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
