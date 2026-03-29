"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "framer-motion";
import { Eye, EyeOff, Loader2, Lock, Sigma, User } from "lucide-react";
import { Bricolage_Grotesque } from "next/font/google";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  weight: ["400", "500", "600", "700", "800"],
});

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormData = z.infer<typeof loginSchema>;

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

const ghostRows = [
  { label: "Transport", pct: 53, amount: "₹1,504" },
  { label: "Utilities", pct:  8, amount: "₹202"   },
  { label: "Groceries", pct: 85, amount: "₹2,406" },
  { label: "Dining",    pct: 36, amount: "₹1,006" },
];

// Spring config reused across all entrance items
const SPRING = { type: "spring" as const, stiffness: 120, damping: 22, mass: 0.8 };

export default function LoginPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const prefersReducedMotion = useReducedMotion();

  // Magnetic button — useMotionValue keeps this off the render cycle
  const buttonRef = useRef<HTMLDivElement>(null);
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const translateX = useTransform(mouseX, [-80, 80], [-5, 5]);
  const translateY = useTransform(mouseY, [-24, 24], [-3, 3]);

  const handleButtonMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (prefersReducedMotion) return;
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    mouseX.set(e.clientX - rect.left - rect.width / 2);
    mouseY.set(e.clientY - rect.top - rect.height / 2);
  };
  const handleButtonMouseLeave = () => {
    mouseX.set(0);
    mouseY.set(0);
  };

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormData) => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { detail?: string }).detail ?? "Invalid credentials");
      }
      router.replace("/transactions");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Login failed");
    } finally {
      setIsLoading(false);
    }
  };


  return (
    <main
      className={`${bricolage.variable} relative min-h-[100dvh] flex overflow-hidden bg-background`}
      style={{
        backgroundImage: [
          "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px)",
          "linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)",
        ].join(", "),
        backgroundSize: "36px 36px",
      }}
    >

      {/* ─── Left brand panel (desktop only) ─── */}
      <div
        className="hidden lg:flex lg:w-[55%] relative flex-col justify-center px-16 overflow-hidden animate-in fade-in-0 duration-700"
        aria-hidden="true"
      >
        {/* Subtle orb */}
        <div className="absolute -top-48 -left-48 w-[40rem] h-[40rem] rounded-full bg-primary/[0.04] blur-[200px] pointer-events-none" />

        {/* Ghost MARTY watermark */}
        <div
          className="absolute bottom-[-0.5rem] left-0 select-none pointer-events-none leading-none tracking-[0.06em] whitespace-nowrap text-foreground/[0.04]"
          style={{
            fontFamily: "var(--font-bricolage), sans-serif",
            fontWeight: 800,
            fontSize: "clamp(7rem, 12vw, 12rem)",
          }}
        >
          MARTY
        </div>

        {/* Foreground content */}
        <div className="relative z-10 space-y-8 max-w-sm">
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground/50 tracking-[0.2em] uppercase font-medium">
              Personal Finance
            </p>
            <h2
              className="text-foreground leading-[1.1]"
              style={{
                fontFamily: "var(--font-bricolage), sans-serif",
                fontWeight: 700,
                fontSize: "2.5rem",
                letterSpacing: "-0.01em",
              }}
            >
              Your finances,{" "}
              <span className="text-foreground/40">privately yours.</span>
            </h2>
            <p className="text-sm text-muted-foreground/60 leading-relaxed">
              Track every transaction. Understand every pattern. All on your own terms.
            </p>
            <p className="text-[0.7rem] text-muted-foreground/50 tracking-[0.04em]">
              <span className="text-primary/70 font-bold">M</span>oney{" "}
              <span className="text-primary/70 font-bold">A</span>nalysis &amp;{" "}
              <span className="text-primary/70 font-bold">R</span>ecording{" "}
              <span className="text-primary/70 font-bold">T</span>ool for{" "}
              <span className="text-primary/70 font-bold">Y</span>ou
            </p>
          </div>

          {/* Ghost budget rows */}
          <div className="space-y-2.5 pointer-events-none" aria-hidden="true">
            {ghostRows.map((row) => (
              <div key={row.label} className="space-y-1">
                <div className="flex items-center justify-between text-[0.6rem] text-muted-foreground/40 tracking-widest uppercase">
                  <span>{row.label}</span>
                  <span className="font-mono">{row.amount}</span>
                </div>
                <div className="h-px w-full bg-muted-foreground/10">
                  <div className="h-full bg-muted-foreground/25" style={{ width: `${row.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ─── Right login panel ─── */}
      <div className="w-full lg:w-[45%] flex items-center justify-center px-6 py-12 relative z-10">
        {/* Mobile-only orb */}
        <div
          className="lg:hidden absolute -top-32 -left-32 w-80 h-80 rounded-full bg-primary/[0.04] blur-[120px] pointer-events-none"
          aria-hidden="true"
        />

        <div className="w-full max-w-md animate-in fade-in-0 slide-in-from-bottom-3 duration-500 delay-100">
          <Card className="w-full backdrop-blur-xl bg-card/90 border-[rgba(255,255,255,0.07)] shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_24px_64px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.05)]">

            <CardHeader className="flex flex-row items-center gap-4 pb-5 pt-7 px-7">
              {/* Icon */}
              <div className="shrink-0">
                <motion.div
                  className="flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20"
                  animate={prefersReducedMotion ? {} : { scale: [1, 1.04, 1] }}
                  transition={{ type: "spring", stiffness: 60, damping: 8, repeat: Infinity, repeatType: "mirror", duration: 2 }}
                >
                  <Sigma className="h-7 w-7 text-primary" />
                </motion.div>
              </div>

              {/* Brand text */}
              <div className="flex flex-col gap-1">
                <div className="flex items-baseline gap-2">
                  <h1
                    className="leading-none text-foreground"
                    style={{
                      fontFamily: "var(--font-bricolage), sans-serif",
                      fontWeight: 800,
                      fontSize: "1.75rem",
                      letterSpacing: "0.06em",
                    }}
                  >
                    MARTY
                  </h1>
                  <span
                    className="leading-none text-foreground/70"
                    style={{
                      fontFamily: "var(--font-bricolage), sans-serif",
                      fontWeight: 600,
                      fontSize: "0.95rem",
                    }}
                  >
                    The Expense Tracker
                  </span>
                </div>
                <p className="text-[0.72rem] text-muted-foreground/50 leading-snug mt-0.5 tracking-[0.02em]">
                  <span className="text-primary/60 font-semibold">M</span>oney{" "}
                  <span className="text-primary/60 font-semibold">A</span>nalysis &amp;{" "}
                  <span className="text-primary/60 font-semibold">R</span>ecording{" "}
                  <span className="text-primary/60 font-semibold">T</span>ool for{" "}
                  <span className="text-primary/60 font-semibold">Y</span>ou
                </p>
              </div>
            </CardHeader>

            <CardContent className="px-7 pb-2">
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" aria-label="Sign in to MARTY">

                {/* Username */}
                <div className="space-y-1.5">
                  <Label htmlFor="username">Username</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                      <User className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    </span>
                    <Input
                      id="username"
                      {...register("username")}
                      autoComplete="username"
                      autoFocus
                      className="h-11 pl-9 hover:border-primary/30 transition-colors"
                    />
                  </div>
                  <AnimatePresence>
                    {errors.username && (
                      <motion.p
                        key="username-error"
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ type: "spring", stiffness: 200, damping: 20 }}
                        className="text-xs text-destructive"
                      >
                        {errors.username.message}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>

                {/* Password */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Password</Label>
                    <span className="text-xs text-muted-foreground/50 hover:text-muted-foreground cursor-pointer transition-colors select-none">
                      Forgot password?
                    </span>
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                      <Lock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    </span>
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      {...register("password")}
                      autoComplete="current-password"
                      className="h-11 pl-9 pr-10 hover:border-primary/30 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      aria-pressed={showPassword}
                      aria-controls="password"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                  <AnimatePresence>
                    {errors.password && (
                      <motion.p
                        key="password-error"
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ type: "spring", stiffness: 200, damping: 20 }}
                        className="text-xs text-destructive"
                      >
                        {errors.password.message}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>

                {/* Magnetic submit button */}
                <div className="pt-1">
                  <motion.div
                    ref={buttonRef}
                    style={prefersReducedMotion ? {} : { x: translateX, y: translateY }}
                    onMouseMove={handleButtonMouseMove}
                    onMouseLeave={handleButtonMouseLeave}
                  >
                    <Button
                      type="submit"
                      className="w-full h-11 bg-primary hover:bg-primary/90 active:scale-[0.98] transition-all duration-150 font-medium tracking-wide shadow-[inset_0_-1px_0_rgba(0,0,0,0.2)]"
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" />
                          Signing in…
                        </>
                      ) : (
                        "Sign in"
                      )}
                    </Button>
                  </motion.div>
                </div>
              </form>
            </CardContent>

            <CardFooter className="justify-center pb-6 pt-3 px-7">
              <p className="text-xs text-muted-foreground/60 text-center">
                Protected by end-to-end encryption
              </p>
            </CardFooter>
          </Card>
        </div>
      </div>
    </main>
  );
}
