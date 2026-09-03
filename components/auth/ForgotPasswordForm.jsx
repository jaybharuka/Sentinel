"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      // Same message shown whether or not the email exists - the backend
      // deliberately never distinguishes, so the UI can't either.
      setMessage(data.message || "If an account exists for that email, a password reset link has been sent.");
    } catch {
      setMessage("Something went wrong. Try again in a moment.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
    >
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-xl">Reset your password</CardTitle>
          <CardDescription>Enter your account email and we'll send a reset link.</CardDescription>
        </CardHeader>
        <CardContent>
          {message ? (
            <p className="text-sm">{message}</p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="email">Email</label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? "Sending…" : "Send reset link"}
              </Button>
              <p className="text-muted-foreground text-xs text-center">
                <a href="/login" className="underline">Back to log in</a>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
