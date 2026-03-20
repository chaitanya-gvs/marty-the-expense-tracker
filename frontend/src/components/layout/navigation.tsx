"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Receipt,
  PieChart,
  CheckCircle,
  Settings,
  CreditCard,
  ChevronLeft,
  Menu,
  Users,
  BarChart3,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const navigation = [
  { name: "Transactions", href: "/transactions", icon: Receipt },
  { name: "Analytics", href: "/analytics", icon: BarChart3 },
  { name: "Budgets", href: "/budgets", icon: PieChart },
  { name: "Settlements", href: "/settlements", icon: Users },
  { name: "Review", href: "/review", icon: CheckCircle },
  { name: "Settings", href: "/settings", icon: Settings },
];

interface NavigationProps {
  isCollapsed: boolean;
  onToggle: () => void;
}

export function Navigation({ isCollapsed, onToggle }: NavigationProps) {
  const pathname = usePathname();
  const [isHeaderHovered, setIsHeaderHovered] = useState(false);

  return (
    <TooltipProvider>
      <nav
        className={cn(
          "flex flex-col bg-sidebar border-r border-sidebar-border h-full transition-all duration-200 z-10 relative",
          isCollapsed ? "w-14" : "w-56"
        )}
      >
        <div className={cn(
          "flex items-center border-b border-sidebar-border transition-all duration-200",
          isCollapsed ? "justify-center p-3" : "justify-between px-4 py-3"
        )}>
          {isCollapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className="flex items-center justify-center cursor-pointer p-2 rounded-md hover:bg-sidebar-accent transition-colors"
                  onClick={onToggle}
                  onMouseEnter={() => setIsHeaderHovered(true)}
                  onMouseLeave={() => setIsHeaderHovered(false)}
                >
                  {isHeaderHovered ? (
                    <Menu className="h-5 w-5 text-primary" />
                  ) : (
                    <CreditCard className="h-5 w-5 text-primary" />
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent side="right" className="ml-2">
                <p>Open sidebar</p>
              </TooltipContent>
            </Tooltip>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-primary" />
                <h1 className="text-sm font-semibold text-sidebar-foreground tracking-tight">Expense Tracker</h1>
              </div>
              <div className="flex items-center gap-1">
                <ThemeToggle />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onToggle}
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              </div>
            </>
          )}
        </div>

        <div className="flex-1 p-2">
          <ul className="space-y-0.5">
            {navigation.map((item) => {
              const isActive = pathname === item.href;
              return (
                <li key={item.name}>
                  {isCollapsed ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Link
                          href={item.href}
                          className={cn(
                            "flex items-center justify-center p-2.5 rounded-md text-sm font-medium transition-all duration-150",
                            isActive
                              ? "bg-sidebar-accent text-primary border-l-2 border-primary"
                              : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
                          )}
                        >
                          <item.icon className={cn(
                            "h-4 w-4 flex-shrink-0",
                            isActive ? "text-primary" : "text-muted-foreground"
                          )} />
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
                        "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-all duration-150",
                        isActive
                          ? "bg-sidebar-accent text-primary border-l-2 border-primary pl-[10px]"
                          : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
                      )}
                    >
                      <item.icon className={cn(
                        "h-4 w-4 flex-shrink-0",
                        isActive ? "text-primary" : "text-muted-foreground"
                      )} />
                      {item.name}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </nav>
    </TooltipProvider>
  );
}
