"use client";

import { useState } from "react";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { LanguageSwitcher } from "@/components/language-switcher";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { User, LogOut } from "lucide-react";
import { authClient, changePassword } from "@/lib/auth-client";
import { getAppCopy } from "@/lib/i18n/copy";

interface ProfileUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function ProfileTab({ user }: { user: ProfileUser }) {
  const locale = useLocale();
  const copy = getAppCopy(locale).settings.profile;
  const initials = getInitials(user.name);
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);

  const handleLogout = async () => {
    await authClient.signOut();
    router.push("/login");
  };

  const handlePasswordChange = async (event: React.FormEvent) => {
    event.preventDefault();
    setPasswordError("");
    setPasswordSuccess("");

    if (newPassword.length < 8) {
      setPasswordError(copy.passwordTooShort);
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(copy.passwordMismatch);
      return;
    }

    setPasswordLoading(true);
    try {
      await changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordSuccess(copy.passwordUpdated);
    } catch (error) {
      setPasswordError(
        error instanceof Error ? error.message : copy.passwordUpdateFailed,
      );
    } finally {
      setPasswordLoading(false);
    }
  };

  return (
    <div className="mt-4 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{copy.title}</CardTitle>
          <CardDescription>{copy.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-6">
            <div className="size-16 rounded-full bg-primary/20 flex items-center justify-center text-primary text-xl font-semibold shrink-0">
              {initials || <User className="size-6" />}
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-muted-foreground">{copy.name}</p>
                <p className="text-sm font-medium text-foreground">
                  {user.name}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{copy.email}</p>
                <p className="text-sm font-medium text-foreground">
                  {user.email}
                </p>
              </div>
            </div>
          </div>
          <div className="mt-6 pt-6 border-t border-border">
            <Button variant="outline" onClick={handleLogout} className="gap-2 text-destructive hover:text-destructive">
              <LogOut className="size-4" />
              {copy.logout}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{copy.passwordTitle}</CardTitle>
          <CardDescription>{copy.passwordDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4 max-w-md" onSubmit={handlePasswordChange}>
            <div className="space-y-2">
              <Label htmlFor="current-password">{copy.currentPassword}</Label>
              <Input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                autoComplete="current-password"
                required
                disabled={passwordLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">{copy.newPassword}</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
                disabled={passwordLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">{copy.confirmPassword}</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
                disabled={passwordLoading}
              />
            </div>
            {passwordError ? (
              <p className="text-sm text-destructive">{passwordError}</p>
            ) : null}
            {passwordSuccess ? (
              <p className="text-sm text-emerald-600">{passwordSuccess}</p>
            ) : null}
            <Button type="submit" disabled={passwordLoading}>
              {passwordLoading ? copy.updatingPassword : copy.updatePassword}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{copy.languageTitle}</CardTitle>
          <CardDescription>{copy.languageDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <LanguageSwitcher />
        </CardContent>
      </Card>
    </div>
  );
}
