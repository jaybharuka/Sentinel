"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SignupForm() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", password: "", confirmPassword: "" });
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
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Signup failed");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Signup failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-xl">Create your merchant account</CardTitle>
        <CardDescription>Get your own dashboard, policy settings, and API key.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="name">Name</label>
            <Input id="name" value={form.name} onChange={(e) => updateField("name", e.target.value)} required />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="email">Email</label>
            <Input id="email" type="email" value={form.email} onChange={(e) => updateField("email", e.target.value)} required />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="password">Password</label>
            <Input id="password" type="password" value={form.password} onChange={(e) => updateField("password", e.target.value)} required minLength={8} />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="confirmPassword">Confirm password</label>
            <Input id="confirmPassword" type="password" value={form.confirmPassword} onChange={(e) => updateField("confirmPassword", e.target.value)} required minLength={8} />
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Creating account…" : "Sign up"}
          </Button>
          <p className="text-muted-foreground text-xs text-center">
            Already have an account? <a href="/login" className="underline">Log in</a>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
