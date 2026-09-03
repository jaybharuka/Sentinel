"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StaggerContainer, StaggerItem } from "@/components/motion/Stagger";
import { useToast } from "@/components/ui/toast";

const FIELDS = [
  {
    key: "autoRefundMaxAmount",
    label: "Max single auto-refund (₹)",
    step: "1",
  },
  {
    key: "dailyRefundCap",
    label: "Daily refund budget (₹)",
    step: "1",
  },
  {
    key: "autoRefundMinRiskScore",
    label: "Auto-refund min risk score (0-1)",
    step: "0.01",
  },
  {
    key: "autoRefundMinConfidence",
    label: "Auto-refund min confidence (0-1)",
    step: "0.01",
  },
  {
    key: "holdForReviewMinRiskScore",
    label: "Hold-for-review risk threshold (0-1)",
    step: "0.01",
  },
];

function formatDateTime(value) {
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SettingsContent() {
  const { toast } = useToast();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  // The full key only ever lives in this component's state, for the one
  // render right after it's generated - it's never part of `form` (which
  // only ever holds apiKeyPrefix) and is never persisted anywhere. Gone on
  // refresh or navigation, by design.
  const [justGeneratedKey, setJustGeneratedKey] = useState(null);
  const [sessions, setSessions] = useState(null);
  const [revokingId, setRevokingId] = useState(null);
  const [loggingOutOthers, setLoggingOutOthers] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then(setForm)
      .catch(() => setForm(null));
  }, []);

  function refetchSessions() {
    fetch("/api/sessions")
      .then((res) => res.json())
      .then((data) => setSessions(data.sessions || []))
      .catch(() => setSessions([]));
  }

  useEffect(() => {
    refetchSessions();
  }, []);

  async function handleRevokeSession(session) {
    const confirmMessage = session.isCurrent
      ? "Log out this device? You'll need to log in again."
      : "Log out this session? It will be signed out immediately.";
    if (!window.confirm(confirmMessage)) return;

    setRevokingId(session.id);
    try {
      const res = await fetch(`/api/sessions/${session.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        toast({ title: "Could not log out session", description: data.error || "Try again.", variant: "error" });
        return;
      }
      if (session.isCurrent) {
        window.location.href = "/login";
        return;
      }
      toast({ title: "Session logged out", variant: "success" });
      refetchSessions();
    } catch {
      toast({ title: "Could not log out session", description: "Try again.", variant: "error" });
    } finally {
      setRevokingId(null);
    }
  }

  async function handleLogoutOthers() {
    if (!window.confirm("Log out of all other devices? Only this session will remain signed in.")) {
      return;
    }
    setLoggingOutOthers(true);
    try {
      const res = await fetch("/api/sessions/logout-others", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Could not log out other sessions", description: data.error || "Try again.", variant: "error" });
        return;
      }
      toast({
        title: "Logged out of other devices",
        description: `${data.revokedCount} session${data.revokedCount === 1 ? "" : "s"} signed out.`,
        variant: "success",
      });
      refetchSessions();
    } catch {
      toast({ title: "Could not log out other sessions", description: "Try again.", variant: "error" });
    } finally {
      setLoggingOutOthers(false);
    }
  }

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleRegenerateKey() {
    const hasExistingKey = Boolean(form.apiKeyPrefix);
    const confirmMessage = hasExistingKey
      ? "Regenerate API key? The old key will stop working immediately."
      : "Generate a new API key?";
    if (!window.confirm(confirmMessage)) {
      return;
    }
    setRegenerating(true);
    try {
      const res = await fetch("/api/settings/regenerate-key", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setForm((prev) => ({ ...prev, apiKeyPrefix: data.apiKeyPrefix }));
        setJustGeneratedKey(data.apiKey);
        toast({
          title: hasExistingKey ? "API key regenerated" : "API key generated",
          description: "Copy it now - you won't see the full key again.",
          variant: "success",
        });
      } else {
        toast({ title: "Regeneration failed", description: data.error || "Try again.", variant: "error" });
      }
    } finally {
      setRegenerating(false);
    }
  }

  async function handleCopyKey() {
    try {
      await navigator.clipboard.writeText(justGeneratedKey);
      toast({ title: "Copied to clipboard", variant: "info" });
    } catch {
      toast({ title: "Could not copy", description: "Select and copy the key manually.", variant: "error" });
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Save failed", description: data.error || "Try again.", variant: "error" });
        return;
      }
      setForm(data);
      toast({ title: "Settings saved", description: "Takes effect on the next transaction processed.", variant: "success" });
    } catch {
      toast({ title: "Save failed", description: "Check your connection and try again.", variant: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <StaggerContainer className="space-y-6">
      <StaggerItem>
        <div>
          <h1 className="text-2xl font-semibold">Merchant policy settings</h1>
          <p className="text-muted-foreground text-sm">
            These bounds gate every money-moving decision the policy gate makes. Changes take
            effect on the next transaction processed.
          </p>
        </div>
      </StaggerItem>

      {!form ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : (
        <StaggerItem><Card>
          <CardHeader>
            <CardTitle className="font-display text-xl">Policy bounds</CardTitle>
            <CardDescription>Merchant: {form.merchantId}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSave} className="space-y-4">
              {FIELDS.map((field) => (
                <div key={field.key} className="space-y-1">
                  <label className="text-sm font-medium" htmlFor={field.key}>
                    {field.label}
                  </label>
                  <Input
                    id={field.key}
                    type="number"
                    step={field.step}
                    value={form[field.key] ?? ""}
                    onChange={(e) => updateField(field.key, e.target.value)}
                  />
                </div>
              ))}

              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="alertEmail">
                  Alert email (optional)
                </label>
                <Input
                  id="alertEmail"
                  type="email"
                  value={form.alertEmail ?? ""}
                  onChange={(e) => updateField("alertEmail", e.target.value)}
                />
              </div>

              <div className="flex items-center gap-3 pt-2">
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving…" : "Save settings"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card></StaggerItem>
      )}

      {form && (
        <StaggerItem><Card>
          <CardHeader>
            <CardTitle className="font-display text-xl">Public API key</CardTitle>
            <CardDescription>
              Read-only access to your transaction data via the versioned v1 API. Anyone with
              this key can read your transaction data. Treat it like a password.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {justGeneratedKey && (
              <div className="space-y-2 rounded-md border-2 border-warning bg-warning/5 p-3">
                <p className="text-warning text-xs font-medium">
                  Copy this now - you won't see the full key again after you leave this page.
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-md border bg-muted px-3 py-2 font-mono text-xs break-all">
                    {justGeneratedKey}
                  </code>
                  <Button type="button" variant="outline" size="sm" onClick={handleCopyKey}>
                    Copy
                  </Button>
                </div>
              </div>
            )}

            <div className="flex items-center gap-3">
              <code className="text-muted-foreground flex-1 rounded-md border bg-muted px-3 py-2 font-mono text-xs break-all">
                {form.apiKeyPrefix
                  ? `${form.apiKeyPrefix}${"•".repeat(32)}`
                  : "No API key generated yet"}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleRegenerateKey}
                disabled={regenerating}
              >
                {regenerating ? "Generating…" : form.apiKeyPrefix ? "Regenerate" : "Generate API key"}
              </Button>
            </div>

            <div>
              <p className="text-muted-foreground text-xs mb-1">
                Authenticate with an Authorization: Bearer header. Try it:
              </p>
              <pre className="rounded-md border bg-muted px-3 py-2 text-xs overflow-x-auto">
{`curl -H "Authorization: Bearer ${justGeneratedKey || "<your-api-key>"}" \\
  "${typeof window !== "undefined" ? window.location.origin : ""}/api/v1/transactions"`}
              </pre>
            </div>
          </CardContent>
        </Card></StaggerItem>
      )}

      <StaggerItem>
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-xl">Active sessions</CardTitle>
            <CardDescription>
              Every device currently signed in to your account. Logging out here actually ends
              that session server-side - it stops working immediately, not just on that device.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!sessions ? (
              <p className="text-muted-foreground text-sm">Loading…</p>
            ) : sessions.length === 0 ? (
              <p className="text-muted-foreground text-sm">No active sessions.</p>
            ) : (
              <div className="rounded-lg border divide-y">
                {sessions.map((session) => (
                  <div key={session.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {session.device}
                        {session.isCurrent && (
                          <span className="text-primary ml-2 text-xs font-normal">This device</span>
                        )}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        Signed in {formatDateTime(session.createdAt)} · last used{" "}
                        {formatDateTime(session.lastUsedAt)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => handleRevokeSession(session)}
                      disabled={revokingId === session.id}
                    >
                      {revokingId === session.id ? "Logging out…" : "Log out"}
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {sessions && sessions.length > 1 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleLogoutOthers}
                disabled={loggingOutOthers}
              >
                {loggingOutOthers ? "Logging out…" : "Log out of all other devices"}
              </Button>
            )}
          </CardContent>
        </Card>
      </StaggerItem>
    </StaggerContainer>
  );
}
