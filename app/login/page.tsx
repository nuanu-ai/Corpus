"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { TrendingUp, Loader2 } from "lucide-react";
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
import { authClient } from "@/lib/auth-client";
import { buildMcpAuthorizeResumeUrl } from "@/lib/mcp-login";

function resolveSafeNextPath(rawValue: string | null): string | null {
  if (!rawValue) return null;
  if (rawValue.startsWith("/")) {
    return rawValue.startsWith("//") ? null : rawValue;
  }

  if (typeof window === "undefined") return null;

  try {
    const url = new URL(rawValue);
    if (url.origin !== window.location.origin) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginSkeleton />}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginSkeleton() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = searchParams.get("mode");
  const skipOnboarding = searchParams.get("skipOnboarding") === "1";
  const nextPath = resolveSafeNextPath(searchParams.get("next"));
  const mcpAuthorizeUrl = buildMcpAuthorizeResumeUrl(searchParams);

  const inviteCode = searchParams.get("code") ?? "";
  const [isSignUp, setIsSignUp] = useState(() => mode === "signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (isSignUp) {
        // No invite code = public friend signup → tier='community' (BYOK).
        // With invite code = tier inherited from the code (e.g. 'managed').
        const { error: signUpError } = await authClient.signUp.email({
          email,
          password,
          name,
          // Forwarded to /api/auth/sign-up/email; the wrapper validates and
          // strips this field, then injects the resolved tier into the body.
          ...(inviteCode ? { inviteCode } : {}),
        } as Parameters<typeof authClient.signUp.email>[0] & { inviteCode?: string });
        if (signUpError) {
          setError(signUpError.message ?? "Sign up failed");
          setLoading(false);
          return;
        }
      } else {
        const { error: signInError } = await authClient.signIn.email({
          email,
          password,
        });
        if (signInError) {
          setError(signInError.message ?? "Sign in failed");
          setLoading(false);
          return;
        }
      }
      if (mcpAuthorizeUrl) {
        window.location.assign(mcpAuthorizeUrl);
      } else if (isSignUp) {
        router.push("/onboarding");
      } else {
        router.push(nextPath ?? (skipOnboarding ? "/dashboard?skipOnboarding=1" : "/dashboard"));
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      {/* Background gradient effects */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/4 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-primary/10 blur-[120px]" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 flex items-center justify-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary">
            <TrendingUp className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="text-xl font-semibold">Corpus</span>
        </div>

        <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">
              {isSignUp ? "Create account" : "Welcome back"}
            </CardTitle>
            <CardDescription>
              {isSignUp
                ? "Sign up to start managing your finances"
                : "Sign in to your Corpus dashboard"}
            </CardDescription>
          </CardHeader>

          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              {isSignUp && (
                <>
                  {inviteCode ? (
                    <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-muted-foreground">
                      Invited via code <code className="font-mono text-foreground">{inviteCode}</code>
                    </div>
                  ) : (
                    <div className="rounded-md border border-muted-foreground/20 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                      Start with company setup first. If this account needs a provider key later, Corpus will ask for it in Settings.
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="name">Name</Label>
                    <Input
                      id="name"
                      type="text"
                      placeholder="Your name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required={isSignUp}
                      disabled={loading}
                    />
                  </div>
                </>
              )}

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  disabled={loading}
                />
              </div>

              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}
            </CardContent>

            <CardFooter className="flex flex-col gap-4">
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {isSignUp ? "Create Account" : "Sign In"}
              </Button>

              {!isSignUp ? (
                <Link
                  href="/reset-password"
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  Forgot password?
                </Link>
              ) : null}

              <button
                type="button"
                onClick={() => {
                  setIsSignUp(!isSignUp);
                  setError("");
                }}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {isSignUp
                  ? "Already have an account? Sign in"
                  : "Don't have an account? Sign up"}
              </button>
            </CardFooter>
          </form>
        </Card>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          <Link href="/" className="transition-colors hover:text-foreground">
            Back to home
          </Link>
        </p>
      </div>
    </div>
  );
}
