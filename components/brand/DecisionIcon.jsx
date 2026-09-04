import { ShieldCheck, PauseCircle, Undo2 } from "lucide-react";

const MAP = {
  allow: { Icon: ShieldCheck, className: "text-success" },
  hold_for_review: { Icon: PauseCircle, className: "text-warning-text" },
  auto_refund: { Icon: Undo2, className: "text-refund" },
};

export function DecisionIcon({ decision, className = "" }) {
  const entry = MAP[decision] || MAP.allow;
  const { Icon, className: colorClass } = entry;
  return <Icon className={`${colorClass} ${className}`} aria-hidden="true" />;
}
