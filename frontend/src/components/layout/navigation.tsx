"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Wallet,
  ArrowLeftRight,
  TrendingUp,
  Target,
  HandCoins,
  ScanSearch,
  SlidersHorizontal,
  LogOut,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const navigation = [
  { name: "Transactions", href: "/transactions", icon: ArrowLeftRight },
  { name: "Analytics", href: "/analytics", icon: TrendingUp },
  { name: "Budgets", href: "/budgets", icon: Target },
  { name: "Settlements", href: "/settlements", icon: HandCoins },
  { name: "Review", href: "/review", icon: ScanSearch },
  { name: "Settings", href: "/settings", icon: SlidersHorizontal },
];

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

export function Navigation() {
  const pathname = usePathname();
  const router = useRouter();
  const [isHovered, setIsHovered] = useState(false);

  const handleLogout = async () => {
    await fetch(`${API_BASE}/auth/logout`, { method: "POST", credentials: "include" });
    router.replace("/login");
  };

  return (
    <TooltipProvider>
      <nav
        className={cn(
          "absolute left-0 top-0 bottom-0 flex flex-col bg-sidebar border-r border-sidebar-border transition-all duration-200 z-50 overflow-hidden",
          isHovered ? "w-56" : "w-14"
        )}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div className={cn(
          "flex items-center border-b border-sidebar-border transition-all duration-200",
          isHovered ? "justify-between px-4 py-3" : "justify-center p-3"
        )}>
          {isHovered ? (
            <>
              <div className="flex items-center gap-2">
                <Wallet className="h-5 w-5 text-primary" />
                <h1 className="text-sm font-semibold text-sidebar-foreground tracking-tight">Expense Tracker</h1>
              </div>
              <ThemeToggle />
            </>
          ) : (
            <Wallet className="h-5 w-5 text-primary" />
          )}
        </div>

        <div className="flex-1 p-2 flex flex-col">
          <ul className="space-y-0.5 flex-1">
            {navigation.filter(item => item.href !== "/settings").map((item) => {
              const isActive = pathname === item.href;
              return (
                <li key={item.name}>
                  {!isHovered ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Link
                          href={item.href}
                          className={cn(
                            "flex items-center justify-center p-2.5 rounded-md text-sm transition-all duration-150",
                            isActive
                              ? "bg-primary/15 text-primary font-semibold"
                              : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground font-medium"
                          )}
                        >
                          <item.icon className="h-4 w-4 flex-shrink-0" />
                        </Link>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="ml-2">
                        <p>{item.name}</p>
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <Link
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-all duration-150",
                        isActive
                          ? "bg-primary/15 text-primary font-semibold"
                          : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground font-medium"
                      )}
                    >
                      <item.icon className="h-4 w-4 flex-shrink-0" />
                      {item.name}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="border-t border-sidebar-border pt-1 mt-1 space-y-0.5">
            {(() => {
              const settingsItem = navigation.find(item => item.href === "/settings")!;
              const isActive = pathname === settingsItem.href;
              return !isHovered ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      href={settingsItem.href}
                      className={cn(
                        "flex items-center justify-center p-2.5 rounded-md text-sm transition-all duration-150",
                        isActive
                          ? "bg-primary/15 text-primary font-semibold"
                          : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground font-medium"
                      )}
                    >
                      <settingsItem.icon className="h-4 w-4 flex-shrink-0" />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="ml-2">
                    <p>{settingsItem.name}</p>
                  </TooltipContent>
                </Tooltip>
              ) : (
                <Link
                  href={settingsItem.href}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-all duration-150",
                    isActive
                      ? "bg-primary/15 text-primary font-semibold"
                      : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground font-medium"
                  )}
                >
                  <settingsItem.icon className="h-4 w-4 flex-shrink-0" />
                  {settingsItem.name}
                </Link>
              );
            })()}

            {!isHovered ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center justify-center p-2.5 rounded-md text-sm transition-all duration-150 text-muted-foreground hover:bg-sidebar-accent hover:text-destructive font-medium"
                  >
                    <LogOut className="h-4 w-4 flex-shrink-0" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="ml-2">
                  <p>Logout</p>
                </TooltipContent>
              </Tooltip>
            ) : (
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-all duration-150 text-muted-foreground hover:bg-sidebar-accent hover:text-destructive font-medium"
              >
                <LogOut className="h-4 w-4 flex-shrink-0" />
                Logout
              </button>
            )}
          </div>
        </div>
      </nav>
    </TooltipProvider>
  );
}
