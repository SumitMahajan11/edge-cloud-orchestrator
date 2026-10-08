"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { Server, Mail, Lock, Eye, EyeOff, Loader2 } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const { user, login, register, isLoading, error, clearError } = useAuth();

  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Redirect if already logged in
  useEffect(() => {
    if (user) {
      router.replace("/");
    }
  }, [user, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();

    if (isLogin) {
      const result = await login(email, password);
      if (result) {
        router.push("/");
      }
    } else {
      if (password.length < 12) {return;}
      const result = await register(email, password, name);
      if (result) {
        setIsLogin(true);
        setEmail(email);
        setPassword("");
      }
    }
  };

  const handleDemoLogin = async () => {
    clearError();
    setEmail("admin@demo-org.com");
    setPassword("Admin123!");
    const result = await login("admin@demo-org.com", "Admin123!");
    if (result) {
      router.push("/");
    }
  };

  if (user) {
    return null; // Will redirect
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-foreground relative">
      {/* Background radial glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 right-1/4 w-[400px] h-[400px] bg-primary/5 rounded-full blur-[100px]" />
        <div className="absolute bottom-1/4 left-1/4 w-[400px] h-[400px] bg-indigo-500/5 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10 w-full max-w-md px-6 py-12">
        {/* Logo and title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-primary/10 border border-primary/20 rounded-2xl mb-4 shadow-lg shadow-primary/5">
            <Server className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground bg-gradient-to-r from-foreground via-foreground/90 to-muted-foreground bg-clip-text">
            EdgeCloud Orchestrator
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            Distributed Compute Management Platform
          </p>
        </div>

        {/* Form Card */}
        <div className="bg-card/40 backdrop-blur-xl rounded-2xl border border-border/80 p-8 shadow-2xl relative overflow-hidden">
          {/* Top subtle highlight */}
          <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-primary/30 to-transparent" />

          {/* Tabs */}
          <div className="flex mb-6 bg-secondary/50 rounded-lg p-1 border border-border/40">
            <button
              type="button"
              onClick={() => {
                setIsLogin(true);
                clearError();
              }}
              className={`flex-1 py-1.5 px-3 rounded-md text-xs font-semibold tracking-wider uppercase transition-all ${
                isLogin
                  ? "bg-primary text-primary-foreground shadow-md"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setIsLogin(false);
                clearError();
              }}
              className={`flex-1 py-1.5 px-3 rounded-md text-xs font-semibold tracking-wider uppercase transition-all ${
                !isLogin
                  ? "bg-primary text-primary-foreground shadow-md"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Sign Up
            </button>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-xs font-medium">
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required={!isLogin}
                  className="w-full px-3 py-2 bg-secondary/30 border border-border/80 rounded-lg text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-transparent transition-all"
                  placeholder="John Doe"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">
                Email Address
              </label>
              <div className="relative">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full pl-9 pr-3 py-2 bg-secondary/30 border border-border/80 rounded-lg text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-transparent transition-all"
                  placeholder="you@example.com"
                />
                <Mail className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={isLogin ? undefined : 12}
                  className="w-full pl-9 pr-10 py-2 bg-secondary/30 border border-border/80 rounded-lg text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-transparent transition-all"
                  placeholder="••••••••"
                />
                <Lock className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
              {!isLogin && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  Minimum 12 characters
                </p>
              )}
            </div>

            {isLogin && (
              <div className="flex items-center justify-between text-xs pt-1">
                <label className="flex items-center text-muted-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="mr-2 rounded border-border bg-secondary text-primary focus:ring-primary"
                  />
                  Remember me
                </label>
                <button
                  type="button"
                  className="text-primary hover:text-primary/80 transition-colors font-medium"
                >
                  Forgot password?
                </button>
              </div>
            )}

            <div className="space-y-2 pt-2">
              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2 bg-primary hover:bg-primary/95 text-primary-foreground font-semibold rounded-lg shadow-lg hover:shadow-primary/5 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center text-sm"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="animate-spin -ml-1 mr-2 h-4 w-4 text-primary-foreground" />
                    Processing...
                  </>
                ) : isLogin ? (
                  "Sign In"
                ) : (
                  "Create Account"
                )}
              </button>

              {isLogin && (
                <button
                  type="button"
                  onClick={handleDemoLogin}
                  disabled={isLoading}
                  className="w-full py-2 bg-secondary/50 hover:bg-secondary/80 border border-border/80 text-foreground font-medium rounded-lg transition-all disabled:opacity-50 flex items-center justify-center text-sm"
                >
                  Quick Sign In (Demo Admin)
                </button>
              )}
            </div>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-muted-foreground text-xs mt-8">
          &copy; 2026 EdgeCloud Orchestrator. All rights reserved.
        </p>
      </div>
    </div>
  );
}
