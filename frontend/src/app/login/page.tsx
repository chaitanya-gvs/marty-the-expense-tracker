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

// Ghost data rows for left panel decoration
const ghostRows = [
  { label: "Groceries", pct: 68, amount: "₹4,230" },
  { label: "Transport", pct: 42, amount: "₹1,890" },
  { label: "Dining", pct: 81, amount: "₹6,100" },
  { label: "Utilities", pct: 29, amount: "₹980" },
];

export default function LoginPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const prefersReducedMotion = useReducedMotion();

  // Magnetic button
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

  // Stagger container — spring physics throughout
  const containerVariants = {
    hidden: {},
    visible: {
      transition: { staggerChildren: 0.07, delayChildren: 0.1 },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: prefersReducedMotion ? 0 : 14 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        type: "spring" as const,
        stiffness: 120,
        damping: 22,
        mass: 0.8,
      },
    },
  };

  const panelVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { duration: prefersReducedMotion ? 0 : 0.9, ease: "easeOut" },
    },
  };

  const crosshatchStyle = {
    backgroundImage: [
      "linear-gradient(rgba(99,102,241,0.08) 1px, transparent 1px)",
      "linear-gradient(90deg, rgba(99,102,241,0.08) 1px, transparent 1px)",
    ].join(", "),
    backgroundSize: "36px 36px",
  };

  return (
    <main
      className={`${bricolage.variable} relative min-h-[100dvh] flex overflow-hidden bg-background`}
      style={crosshatchStyle}
    >
      {/* ─── Left brand panel (desktop only) ─── */}
      <motion.div
        className="hidden lg:flex lg:w-[55%] relative flex-col items-start justify-center px-16 overflow-hidden"
        variants={panelVariants}
        initial="hidden"
        animate="visible"
        aria-hidden="true"
      >
        {/* Background orbs — asymmetric */}
        <div className="absolute -top-40 -left-40 w-[36rem] h-[36rem] rounded-full bg-primary/10 blur-[160px] pointer-events-none" />
        <div className="absolute top-1/3 -left-16 w-80 h-80 rounded-full bg-violet-500/[0.06] blur-[100px] pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-64 h-64 rounded-full bg-primary/[0.04] blur-[80px] pointer-events-none" />

        {/* Giant ghost MARTY watermark */}
        <div
          className="absolute inset-0 flex items-center justify-start pl-8 select-none pointer-events-none overflow-hidden"
        >
          <span
            className="text-foreground/[0.032] leading-none tracking-[0.06em] whitespace-nowrap"
            style={{
              fontFamily: "var(--font-bricolage), sans-serif",
              fontWeight: 800,
              fontSize: "clamp(8rem, 14vw, 14rem)",
            }}
          >
            MARTY
          </span>
        </div>

        {/* Ghost Sigma icon */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
          <Sigma className="h-28 w-28 text-primary/[0.06]" />
        </div>

        {/* Brand content — foreground layer */}
        <div className="relative z-10 space-y-10">
          {/* Brand identity */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/15 border border-primary/20">
                <Sigma className="h-5 w-5 text-primary" />
              </div>
              <span
                className="text-foreground/50 text-sm tracking-widest uppercase"
                style={{ fontFamily: "var(--font-bricolage), sans-serif", fontWeight: 600 }}
              >
                MARTY
              </span>
            </div>
            <h2
              className="text-foreground/80 leading-tight max-w-sm"
              style={{
                fontFamily: "var(--font-bricolage), sans-serif",
                fontWeight: 700,
                fontSize: "2.25rem",
                letterSpacing: "-0.01em",
              }}
            >
              Your finances,{" "}
              <span className="text-foreground/40">privately yours.</span>
            </h2>
            <p className="text-sm text-muted-foreground/60 max-w-xs leading-relaxed">
              Money Analysis &amp; Recording Tool for You — track every rupee, understand every pattern.
            </p>
          </div>

          {/* Ghost data decorations */}
          <div className="space-y-3 opacity-[0.45] pointer-events-none" aria-hidden="true">
            {ghostRows.map((row) => (
              <div key={row.label} className="space-y-1">
                <div className="flex items-center justify-between text-[0.65rem] text-muted-foreground/50 tracking-wide uppercase">
                  <span>{row.label}</span>
                  <span className="font-mono">{row.amount}</span>
                </div>
                <div className="h-[3px] rounded-full bg-muted-foreground/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary/30"
                    style={{ width: `${row.pct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </motion.div>

      {/* ─── Right login panel ─── */}
      <div className="w-full lg:w-[45%] flex items-center justify-center px-6 py-12 relative z-10">
        {/* Mobile-only orb (hidden on lg+ where left panel has the orbs) */}
        <div className="lg:hidden absolute -top-32 -left-32 w-80 h-80 rounded-full bg-primary/10 blur-[120px] pointer-events-none" aria-hidden="true" />

        <motion.div
          className="w-full max-w-md"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          <Card className="w-full backdrop-blur-xl bg-card/80 border-[rgba(255,255,255,0.10)] shadow-[0_0_0_1px_rgba(99,102,241,0.12),0_24px_64px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.07)]">

            {/* Header: icon + name */}
            <CardHeader className="flex flex-row items-center gap-4 pb-5 pt-7 px-7">
              <motion.div variants={itemVariants} className="shrink-0">
                <motion.div
                  className="flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/20 to-violet-600/10 border border-primary/20"
                  animate={prefersReducedMotion ? {} : { scale: [1, 1.04, 1] }}
                  transition={{
                    type: "spring",
                    stiffness: 60,
                    damping: 8,
                    repeat: Infinity,
                    repeatType: "mirror",
                    duration: 2,
                  }}
                >
                  <Sigma className="h-7 w-7 text-primary" />
                </motion.div>
              </motion.div>

              <motion.div variants={itemVariants} className="flex flex-col gap-1">
                <div className="flex items-baseline gap-2">
                  <h1
                    className="leading-none text-foreground"
                    style={{
                      fontFamily: "var(--font-bricolage), var(--font-dm-sans), sans-serif",
                      fontWeight: 800,
                      fontSize: "1.75rem",
                      letterSpacing: "0.06em",
                    }}
                  >
                    MARTY
                  </h1>
                  <span
                    className="leading-none text-foreground"
                    style={{
                      fontFamily: "var(--font-bricolage), var(--font-dm-sans), sans-serif",
                      fontWeight: 700,
                      fontSize: "1rem",
                    }}
                  >
                    The Expense Tracker
                  </span>
                </div>
                <p className="text-[0.8rem] text-muted-foreground/70 leading-snug mt-0.5">
                  Your finances, privately yours.
                </p>
              </motion.div>
            </CardHeader>

            <CardContent className="px-7 pb-2">
              <form
                onSubmit={handleSubmit(onSubmit)}
                className="space-y-4"
                aria-label="Sign in to MARTY"
              >
                {/* Username field */}
                <motion.div variants={itemVariants} className="space-y-1.5">
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
                </motion.div>

                {/* Password field */}
                <motion.div variants={itemVariants} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Password</Label>
                    <span className="text-xs text-muted-foreground/60 hover:text-muted-foreground cursor-pointer transition-colors select-none">
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
                </motion.div>

                {/* Submit button — magnetic */}
                <motion.div variants={itemVariants} className="pt-1">
                  <motion.div
                    ref={buttonRef}
                    style={
                      prefersReducedMotion
                        ? {}
                        : { x: translateX, y: translateY }
                    }
                    onMouseMove={handleButtonMouseMove}
                    onMouseLeave={handleButtonMouseLeave}
                  >
                    <Button
                      type="submit"
                      className="w-full h-11 bg-primary hover:bg-primary/90 active:scale-[0.98] transition-all duration-150 font-medium tracking-wide shadow-[inset_0_-1px_0_rgba(0,0,0,0.25)]"
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
                </motion.div>
              </form>
            </CardContent>

            <CardFooter className="justify-center pb-6 pt-3 px-7">
              <motion.p
                variants={itemVariants}
                className="text-xs text-muted-foreground/60 text-center"
              >
                Protected by end-to-end encryption
              </motion.p>
            </CardFooter>
          </Card>
        </motion.div>
      </div>
    </main>
  );
}
