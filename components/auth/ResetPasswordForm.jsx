"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, confirmPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Reset failed");
        return;
      }
      setDone(true);
      setTimeout(() => router.push("/login"), 2000);
    } catch {
      setError("Reset failed. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-xl">Invalid link</CardTitle>
          <CardDescription>This password reset link is missing its token.</CardDescription>
        </CardHeader>
        <CardContent>
          <a href="/forgot-password" className="text-sm underline">Request a new link</a>
        </CardContent>
      </Card>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
    >
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-xl">Set a new password</CardTitle>
          <CardDescription>
            {done ? "Password updated. Redirecting to log in…" : "Choose a new password for your account."}
          </CardDescription>
        </CardHeader>
        {!done && (
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="password">New password</label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="confirmPassword">Confirm new password</label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </div>
              {error && <p className="text-destructive text-sm">{error}</p>}
              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? "Updating…" : "Update password"}
              </Button>
            </form>
          </CardContent>
        )}
      </Card>
    </motion.div>
  );
}
