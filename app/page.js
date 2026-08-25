import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { GateVisualization } from "@/components/brand/GateVisualization";
import { PipelineFlow } from "@/components/brand/PipelineFlow";
import { ThemeToggle } from "@/components/layout/ThemeToggle";

export default function Home() {
  return (
    <div className="flex-1">
      {/* Header */}
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <span className="font-display text-lg font-semibold tracking-tight">Sentinel</span>
          <nav className="flex items-center gap-2 sm:gap-4">
            <a
              href="#how-it-works"
              className="hidden text-sm text-muted-foreground hover:text-foreground sm:inline"
            >
              How it works
            </a>
            <ThemeToggle />
            <Button variant="ghost" size="sm" asChild>
              <Link href="/login">Log in</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/signup">Sign up</Link>
            </Button>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 py-16 sm:py-24">
        <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-primary">
              Fraud &amp; chargeback risk guard
            </p>
            <h1 className="mt-4 font-display text-4xl font-semibold leading-[1.05] sm:text-5xl">
              The AI can suggest.
              <br />
              Only the gate can move money.
            </h1>
            <p className="mt-5 max-w-lg text-base text-muted-foreground sm:text-lg">
              Sentinel AI scores every Razorpay payment for fraud risk. A fixed, auditable set of
              rules, not the model, decides whether it's allowed, held for review, or
              auto-refunded.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button size="lg" asChild>
                <Link href="/signup">Get started</Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <a href="#how-it-works">See how it works</a>
              </Button>
            </div>
          </div>

          <Card className="border-border/80 shadow-sm">
            <CardContent className="pt-2">
              <GateVisualization />
            </CardContent>
          </Card>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="border-t border-border bg-secondary/40">
        <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
          <h2 className="font-display text-2xl font-semibold sm:text-3xl">
            How it works
          </h2>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            One payment, four stages, one honest audit trail, every time.
          </p>
          <div className="mt-10">
            <PipelineFlow />
          </div>
        </div>
      </section>

      {/* Footer CTA */}
      <section className="mx-auto max-w-6xl px-6 py-16 text-center sm:py-20">
        <h2 className="font-display text-2xl font-semibold sm:text-3xl">
          Bring your own bounds.
        </h2>
        <p className="mx-auto mt-2 max-w-md text-muted-foreground">
          Set your own refund caps and thresholds. The gate enforces whatever you configure.
        </p>
        <div className="mt-6">
          <Button size="lg" asChild>
            <Link href="/signup">Create your account</Link>
          </Button>
        </div>
      </section>

      <footer className="border-t border-border py-6">
        <p className="mx-auto max-w-6xl px-6 text-xs text-muted-foreground">
          Sentinel: explainable, bounded, gated fraud risk detection.
        </p>
      </footer>
    </div>
  );
}
