"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

// Lightweight, dependency-free tooltip - no radix/floating-ui, just a
// toggled absolutely-positioned popover. Fine for short, static
// explanatory strings; not meant to replace a real positioning library
// if this ever needs to avoid viewport edges dynamically.
let tooltipIdCounter = 0;

export function InfoTooltip({ text, className }) {
  const [open, setOpen] = useState(false);
  const [id] = useState(() => `info-tooltip-${++tooltipIdCounter}`);

  return (
    <span
      className={cn("relative inline-flex align-middle", className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-label="More info"
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        className="inline-flex size-4 items-center justify-center rounded-full border border-muted-foreground/40 text-muted-foreground text-[10px] leading-none hover:border-foreground hover:text-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none"
      >
        ?
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute left-1/2 top-full z-50 mt-1.5 w-56 -translate-x-1/2 rounded-md border bg-popover px-2.5 py-1.5 text-xs font-normal text-popover-foreground shadow-md"
        >
          {text}
        </span>
      )}
    </span>
  );
}
