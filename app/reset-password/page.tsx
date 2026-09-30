"use client";

import Link from "next/link";
import { TrendingUp } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const passwordResetEnabled = process.env.NEXT_PUBLIC_PASSWORD_RESET_ENABLED === "true";

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/4 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-primary/10 blur-[120px]" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        <div className="mb-8 flex items-center justify-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary">
            <TrendingUp className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="text-xl font-semibold">Corpus</span>
        </div>

        <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Password reset</CardTitle>
            <CardDescription>
              {passwordResetEnabled
                ? "Password reset by email is enabled for this workspace."
                : "Password reset by email is not configured yet."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            {passwordResetEnabled ? (
              <p>
                Use the reset link sent to your email address. If you are already signed in,
                you can also change your password from Settings.
              </p>
            ) : (
              <>
                <p>
                  If you are already signed in, open Settings and change your password there.
                </p>
                <p>
                  If you are locked out, a platform admin needs to issue a one-time reset until
                  mail delivery is configured.
                </p>
              </>
            )}
            <div className="pt-2">
              <Button asChild variant="outline" className="w-full">
                <Link href="/login">Back to login</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
