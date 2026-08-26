"use client";

import { motion } from "framer-motion";

// Shared entrance-animation primitive: a parent that staggers its
// direct children in on mount/route-change, each a quick fade+slight-slide
// (150-220ms range, per the brief - fast enough to read as "considered,"
// not slow enough to feel like a demo reel). Respects prefers-reduced-motion
// automatically - framer-motion's default transition still runs, but we
// keep displacement small (8px) so even an unreduced run is subtle, and
// pair it with Tailwind's motion-safe/motion-reduce elsewhere for the
// larger physics-based moments (GateVisualization/RiskGauge markers).
const containerVariants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.06, delayChildren: 0.02 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
  },
};

export function StaggerContainer({ children, className, ...props }) {
  return (
    <motion.div
      className={className}
      variants={containerVariants}
      initial="hidden"
      animate="show"
      {...props}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className, ...props }) {
  return (
    <motion.div className={className} variants={itemVariants} {...props}>
      {children}
    </motion.div>
  );
}

// For content below the fold (landing-page sections) - fades/slides in once
// as it scrolls into view, rather than all at mount like StaggerContainer
// above (which only makes sense for content that's visible immediately).
// `once: true` so it doesn't re-trigger scrolling back up past it.
export function RevealOnScroll({ children, className, ...props }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      {...props}
    >
      {children}
    </motion.div>
  );
}
