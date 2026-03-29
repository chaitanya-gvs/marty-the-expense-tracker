"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Eye, EyeOff, Loader2, Lock, Sigma, User } from "lucide-react";
import { Bricolage_Grotesque } from "next/font/google";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
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

export default function LoginPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const prefersReducedMotion = useReducedMotion();

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

  const containerVariants = {
    hidden: {},
    visible: {
      transition: { staggerChildren: 0.07, delayChildren: 0.15 },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: prefersReducedMotion ? 0 : 12 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: prefersReducedMotion ? 0 : 0.4,
        ease: [0.25, 0.46, 0.45, 0.94],
      },
    },
  };

  const backgroundVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { duration: prefersReducedMotion ? 0 : 0.8 },
    },
  };

  return (
    <div
      className={`${bricolage.variable} relative min-h-screen flex items-center justify-center bg-background overflow-hidden px-4`}
      style={{
        backgroundImage: [
          "linear-gradient(rgba(99,102,241,0.055) 1px, transparent 1px)",
          "linear-gradient(90deg, rgba(99,102,241,0.055) 1px, transparent 1px)",
        ].join(", "),
        backgroundSize: "36px 36px",
      }}
    >
      {/* Atmospheric glow orbs */}
      <motion.div
        variants={backgroundVariants}
        initial="hidden"
        animate="visible"
        aria-hidden="true"
      >
        <div className="absolute -top-40 -left-40 w-[32rem] h-[32rem] rounded-full bg-primary/10 blur-[150px] pointer-events-none" />
        <div className="absolute -bottom-32 -right-20 w-80 h-80 rounded-full bg-violet-500/[0.07] blur-[100px] pointer-events-none" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[36rem] h-[36rem] rounded-full bg-primary/[0.025] blur-[130px] pointer-events-none" />
      </motion.div>

      {/* Card */}
      <motion.div
        className="w-full max-w-md relative z-10"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <Card className="w-full backdrop-blur-xl bg-card/80 border-[rgba(255,255,255,0.10)] shadow-[0_0_0_1px_rgba(99,102,241,0.12),0_24px_64px_rgba(0,0,0,0.6)]">

          {/* Header: icon + name side-by-side */}
          <CardHeader className="flex flex-row items-center gap-4 pb-5 pt-7 px-7">
            <motion.div variants={itemVariants} className="shrink-0">
              <motion.div
                className="flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/20 to-violet-600/10 border border-primary/20"
                animate={prefersReducedMotion ? {} : { scale: [1, 1.04, 1] }}
                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
              >
                <Sigma className="h-7 w-7 text-primary" />
              </motion.div>
            </motion.div>

            <motion.div variants={itemVariants} className="flex flex-col gap-1">
              {/* MARTY + the Expense Tracker on one line, baseline-aligned */}
              <div className="flex items-baseline gap-2">
                <h1
                  className="leading-none bg-gradient-to-r from-foreground to-foreground/75 bg-clip-text text-transparent"
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
              {/* Acronym expansion then tagline */}
              <p className="text-[0.6rem] text-muted-foreground/35 tracking-widest uppercase leading-none">
                Money Analysis &amp; Recording Tool for You
              </p>
              <p className="text-[0.8rem] text-muted-foreground/70 leading-snug mt-1">
                Your finances, privately yours.
              </p>
            </motion.div>
          </CardHeader>

          <CardContent className="px-7 pb-2">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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
                    className="h-11 pl-9"
                  />
                </div>
                <AnimatePresence>
                  {errors.username && (
                    <motion.p
                      key="username-error"
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="text-xs text-destructive"
                    >
                      {errors.username.message}
                    </motion.p>
                  )}
                </AnimatePresence>
              </motion.div>

              {/* Password field */}
              <motion.div variants={itemVariants} className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                    <Lock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  </span>
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    {...register("password")}
                    autoComplete="current-password"
                    className="h-11 pl-9 pr-10"
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
                      transition={{ duration: 0.2 }}
                      className="text-xs text-destructive"
                    >
                      {errors.password.message}
                    </motion.p>
                  )}
                </AnimatePresence>
              </motion.div>

              {/* Submit button */}
              <motion.div variants={itemVariants} className="pt-1">
                <Button
                  type="submit"
                  className="w-full h-11 bg-gradient-to-r from-primary to-violet-500 hover:from-primary/90 hover:to-violet-500/90 hover:shadow-[0_0_20px_rgba(99,102,241,0.4)] transition-all duration-200 font-medium"
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
            </form>
          </CardContent>

          <CardFooter className="justify-center pb-6 pt-3 px-7">
            <motion.p
              variants={itemVariants}
              className="text-xs text-muted-foreground/40 text-center"
            >
              Protected by end-to-end encryption
            </motion.p>
          </CardFooter>
        </Card>
      </motion.div>
    </div>
  );
}
