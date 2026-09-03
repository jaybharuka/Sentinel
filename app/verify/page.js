"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

function VerifyContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState("verifying"); // verifying | success | error
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setError("Missing verification token.");
      return;
    }
    fetch("/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          setStatus("error");
          setError(data.error || "Verification failed");
          return;
        }
        setStatus("success");
      })
      .catch(() => {
        setStatus("error");
        setError("Verification failed. Check your connection and try again.");
      });
  }, [token]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-xl">
          {status === "verifying" && "Verifying…"}
          {status === "success" && "Email verified"}
          {status === "error" && "Verification failed"}
        </CardTitle>
        <CardDescription>
          {status === "verifying" && "Confirming your email address."}
          {status === "success" && "Your email address is confirmed."}
          {status === "error" && error}
        </CardDescription>
      </CardHeader>
      {status !== "verifying" && (
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/dashboard">Go to dashboard</Link>
          </Button>
        </CardContent>
      )}
    </Card>
  );
}

export default function VerifyPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="mb-8 block text-center font-display text-lg font-semibold tracking-tight"
        >
          Sentinel
        </Link>
        <Suspense fallback={<p className="text-muted-foreground text-center text-sm">Loading…</p>}>
          <VerifyContent />
        </Suspense>
      </div>
    </div>
  );
}
