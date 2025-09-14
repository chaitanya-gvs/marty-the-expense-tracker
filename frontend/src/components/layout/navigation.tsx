"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { 
  Receipt, 
  PieChart, 
  CheckCircle, 
  Settings, 
  CreditCard,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

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

  return (
    <nav className={cn(
      "flex flex-col bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 h-full transition-all duration-300",
      isCollapsed ? "w-16" : "w-64"
    )}>
      <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
        <div className={cn(
          "flex items-center gap-2 transition-all duration-300",
          isCollapsed && "justify-center"
        )}>
          <CreditCard className="h-8 w-8 text-blue-600 dark:text-blue-400" />
          {!isCollapsed && (
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Expense Tracker</h1>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isCollapsed && <ThemeToggle />}
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggle}
            className="h-8 w-8 p-0"
          >
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
      
      <div className="flex-1 p-4">
        <ul className="space-y-2">
          {navigation.map((item) => {
            const isActive = pathname === item.href;
            return (
              <li key={item.name}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                    isCollapsed ? "justify-center" : "",
                    isActive
                      ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-r-2 border-blue-700 dark:border-blue-400"
                      : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white"
                  )}
                  title={isCollapsed ? item.name : undefined}
                >
                  <item.icon className="h-5 w-5 flex-shrink-0" />
                  {!isCollapsed && item.name}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
