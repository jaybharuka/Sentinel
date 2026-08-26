import Link from "next/link";
import { Button } from "@/components/ui/button";
import { GateVisualization } from "@/components/brand/GateVisualization";
import { PipelineFlow } from "@/components/brand/PipelineFlow";
import { RiskGauge } from "@/components/brand/RiskGauge";
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
      <section className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
        <div className="max-w-2xl">
          <h1 className="font-display leading-[1.05]">
            <span className="block text-xl font-medium text-muted-foreground sm:text-2xl">
              The AI can suggest.
            </span>
            <span className="mt-1 block text-5xl font-semibold sm:text-6xl lg:text-7xl">
              Only the gate can move money.
            </span>
          </h1>
          <p className="mt-6 max-w-lg text-base text-muted-foreground sm:text-lg">
            Sentinel AI scores every Razorpay payment for fraud risk. A fixed, auditable set of
            rules, not the model, decides whether it's allowed, held for review, or auto-refunded.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-5">
            <Button size="lg" asChild>
              <Link href="/signup">Get started</Link>
            </Button>
            <a
              href="#how-it-works"
              className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              See how it works
            </a>
          </div>
        </div>

        {/* The instrument panel, not a card next to the copy - this is the
            actual policy gate, given the room to be the page's dominant
            visual instead of a decorative illustration beside the headline. */}
        <div className="mt-14 sm:mt-16">
          <GateVisualization />
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
      <section className="border-t border-border">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-16 sm:py-20 lg:grid-cols-[1fr_1.2fr] lg:items-center">
          <div>
            <h2 className="font-display text-2xl font-semibold sm:text-3xl">
              Bring your own bounds.
            </h2>
            <p className="mt-2 max-w-sm text-muted-foreground">
              Set your own refund caps and thresholds. The gate enforces whatever you configure,
              not what the model recommends.
            </p>
            <div className="mt-6">
              <Button size="lg" asChild>
                <Link href="/signup">Create your account</Link>
              </Button>
            </div>
          </div>

          <div className="rounded-lg border border-border p-6">
            <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              Default bounds, shown live
            </p>
            <div className="mt-4">
              <RiskGauge />
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              Every merchant starts here. Move the hold-for-review and auto-refund thresholds to
              whatever your risk tolerance is in Settings after signup, the gate enforces
              whichever numbers you set, not these defaults.
            </p>
          </div>
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
