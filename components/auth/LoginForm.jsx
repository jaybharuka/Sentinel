"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LoginForm() {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Login failed");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Login failed");
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
        <CardTitle className="font-display text-xl">Log in</CardTitle>
        <CardDescription>Access your merchant dashboard.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="email">Email</label>
            <Input id="email" type="email" value={form.email} onChange={(e) => updateField("email", e.target.value)} required />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium" htmlFor="password">Password</label>
              <a href="/forgot-password" className="text-muted-foreground hover:text-foreground text-xs underline">
                Forgot password?
              </a>
            </div>
            <Input id="password" type="password" value={form.password} onChange={(e) => updateField("password", e.target.value)} required />
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Logging in…" : "Log in"}
          </Button>
          <p className="text-muted-foreground text-xs text-center">
            Don't have an account? <a href="/signup" className="underline">Sign up</a>
          </p>
        </form>
      </CardContent>
    </Card>
    </motion.div>
  );
}
