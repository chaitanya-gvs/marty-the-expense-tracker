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
  ChevronRight,
  Menu
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
  { name: "Budgets", href: "/budgets", icon: PieChart },
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
          "flex flex-col bg-slate-900 dark:bg-slate-900 border-r border-slate-700 h-full transition-all duration-300 z-10 relative",
          isCollapsed ? "w-16" : "w-64"
        )}
      >
        <div className={cn(
          "flex items-center border-b border-slate-700 transition-all duration-300",
          isCollapsed ? "justify-center p-4" : "justify-between p-6"
        )}>
          {isCollapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <div 
                  className="flex items-center justify-center cursor-pointer p-2 rounded-lg hover:bg-slate-800 transition-colors"
                  onClick={onToggle}
                  onMouseEnter={() => setIsHeaderHovered(true)}
                  onMouseLeave={() => setIsHeaderHovered(false)}
                >
                  {isHeaderHovered ? (
                    <Menu className="h-8 w-8 text-blue-400" />
                  ) : (
                    <CreditCard className="h-8 w-8 text-blue-400" />
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
                <CreditCard className="h-8 w-8 text-blue-400" />
                <h1 className="text-xl font-bold text-white">Expense Tracker</h1>
              </div>
              <div className="flex items-center gap-2">
                <ThemeToggle />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onToggle}
                  className="h-8 w-8 p-0 text-slate-400 hover:text-white hover:bg-slate-800"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              </div>
            </>
          )}
        </div>
        
        <div className="flex-1 p-4">
          <ul className="space-y-1">
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
                            "flex items-center justify-center px-3 py-3 rounded-lg text-sm font-medium transition-all duration-200",
                            isActive
                              ? "bg-slate-800 text-white border-r-2 border-blue-400 shadow-sm"
                              : "text-slate-300 hover:bg-slate-800 hover:text-white"
                          )}
                        >
                          <item.icon className={cn(
                            "h-5 w-5 flex-shrink-0",
                            isActive ? "text-blue-400" : "text-slate-400"
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
                        "flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-all duration-200",
                        isActive
                          ? "bg-slate-800 text-white border-r-2 border-blue-400 shadow-sm"
                          : "text-slate-300 hover:bg-slate-800 hover:text-white"
                      )}
                    >
                      <item.icon className={cn(
                        "h-5 w-5 flex-shrink-0",
                        isActive ? "text-blue-400" : "text-slate-400"
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