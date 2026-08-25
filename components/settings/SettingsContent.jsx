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

export function SettingsContent() {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then(setForm)
      .catch(() => setForm(null));
  }, []);

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleRegenerateKey() {
    if (!window.confirm("Regenerate API key? The old key will stop working immediately.")) {
      return;
    }
    setRegenerating(true);
    try {
      const res = await fetch("/api/settings/regenerate-key", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setForm(data);
        setMessage({ type: "success", text: "API key regenerated. Update any integrations using the old key." });
      }
    } finally {
      setRegenerating(false);
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "error", text: data.error || "Save failed" });
        return;
      }
      setForm(data);
      setMessage({ type: "success", text: "Settings saved." });
    } catch {
      setMessage({ type: "error", text: "Save failed" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Merchant policy settings</h1>
        <p className="text-muted-foreground text-sm">
          These bounds gate every money-moving decision the policy gate makes. Changes take
          effect on the next transaction processed.
        </p>
      </div>

      {!form ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : (
        <Card>
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
                {message && (
                  <p
                    className={
                      message.type === "error"
                        ? "text-destructive text-sm"
                        : "text-success text-sm"
                    }
                  >
                    {message.text}
                  </p>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {form && (
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-xl">Public API key</CardTitle>
            <CardDescription>
              Read-only access to your transaction data via the versioned v1 API. Anyone with
              this key can read your transaction data. Treat it like a password.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3">
              <code className="flex-1 rounded-md border bg-muted px-3 py-2 font-mono text-xs break-all">
                {form.apiKey}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleRegenerateKey}
                disabled={regenerating}
              >
                {regenerating ? "Regenerating…" : "Regenerate"}
              </Button>
            </div>

            <div>
              <p className="text-muted-foreground text-xs mb-1">
                Authenticate with an Authorization: Bearer header. Try it:
              </p>
              <pre className="rounded-md border bg-muted px-3 py-2 text-xs overflow-x-auto">
{`curl -H "Authorization: Bearer ${form.apiKey}" \\
  "${typeof window !== "undefined" ? window.location.origin : ""}/api/v1/transactions"`}
              </pre>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
