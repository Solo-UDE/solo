"use client";

import { cn } from "@/lib/utils";
import type { MotionProps } from "motion/react";
import { motion } from "motion/react";
import type { ComponentType, CSSProperties, ElementType, JSX } from "react";
import { memo, useMemo } from "react";

type MotionHTMLProps = MotionProps & Record<string, unknown>;

// Cache motion components at module level to avoid creating during render
const motionComponentCache = new Map<
  keyof JSX.IntrinsicElements,
  ComponentType<MotionHTMLProps>
>();

const getMotionComponent = (element: keyof JSX.IntrinsicElements) => {
  let component = motionComponentCache.get(element);
  if (!component) {
    component = motion.create(element);
    motionComponentCache.set(element, component);
  }
  return component;
};

export interface TextShimmerProps {
  children: string;
  as?: ElementType;
  className?: string;
  duration?: number;
  spread?: number;
}

const ShimmerComponent = ({
  children,
  as: Component = "p",
  className,
  duration = 2,
  spread = 2,
}: TextShimmerProps) => {
  const MotionComponent = getMotionComponent(
    Component as keyof JSX.IntrinsicElements
  );

  const dynamicSpread = useMemo(
    () => (children?.length ?? 0) * spread,
    [children, spread]
  );

  return (
    <MotionComponent
      animate={{ backgroundPosition: "0% center" }}
      className={cn(
        "relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent",
        "[background-repeat:no-repeat,padding-box]",
        className
      )}
      initial={{ backgroundPosition: "100% center" }}
      style={
        {
          "--spread": `${dynamicSpread}px`,
          backgroundImage:
            "linear-gradient(90deg, transparent calc(50% - var(--spread)), var(--background), transparent calc(50% + var(--spread))), linear-gradient(var(--muted-foreground), var(--muted-foreground))",
        } as CSSProperties
      }
      transition={{
        duration,
        ease: "linear",
        repeat: Number.POSITIVE_INFINITY,
      }}
    >
      {children}
    </MotionComponent>
  );
};

export const Shimmer = memo(ShimmerComponent);

export interface ShineFxProps extends TextShimmerProps {
  variant?: "heading-default-xl" | "body-default-sm" | (string & {});
}

const ShineFxComponent = ({
  variant,
  className,
  as = "span",
  ...props
}: ShineFxProps) => (
  <Shimmer
    as={as}
    className={cn(
      variant === "heading-default-xl" && "text-xl font-semibold",
      variant === "body-default-sm" && "text-sm font-medium",
      className
    )}
    {...props}
  />
);

export const ShineFx = memo(ShineFxComponent);
