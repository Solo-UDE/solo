import { useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useUIStore } from '@/stores/uiStore';
import { TOUR_STEPS } from './tourSteps';

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PADDING = 8; // px around highlighted element
const TRANSITION_DURATION = 300; // ms

export function TourOverlay() {
  const tourStep = useUIStore((s) => s.tourStep);
  const nextTourStep = useUIStore((s) => s.nextTourStep);
  const prevTourStep = useUIStore((s) => s.prevTourStep);
  const endTour = useUIStore((s) => s.endTour);

  const [spotlightRect, setSpotlightRect] = useState<SpotlightRect | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  const step = TOUR_STEPS[tourStep];
  const isFirstStep = tourStep === 0;
  const isLastStep = tourStep === TOUR_STEPS.length - 1;

  // Measure the target element and update spotlight position
  const updateSpotlight = useCallback(() => {
    if (!step?.target) {
      setSpotlightRect(null);
      return;
    }

    const element = document.querySelector(`[data-tour="${step.target}"]`);
    if (!element) {
      setSpotlightRect(null);
      return;
    }

    const rect = element.getBoundingClientRect();
    setSpotlightRect({
      top: rect.top - PADDING,
      left: rect.left - PADDING,
      width: rect.width + PADDING * 2,
      height: rect.height + PADDING * 2,
    });
  }, [step]);

  // Recalculate spotlight on step change and window resize
  useEffect(() => {
    updateSpotlight();

    window.addEventListener('resize', updateSpotlight);

    // Observe size changes on the target element
    if (step?.target) {
      const element = document.querySelector(`[data-tour="${step.target}"]`);
      if (element) {
        observerRef.current = new ResizeObserver(updateSpotlight);
        observerRef.current.observe(element);
      }
    }

    return () => {
      window.removeEventListener('resize', updateSpotlight);
      observerRef.current?.disconnect();
    };
  }, [step, updateSpotlight]);

  // ESC key to exit tour
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        endTour();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [endTour]);

  const handleNext = useCallback(() => {
    if (isLastStep) {
      endTour();
    } else {
      nextTourStep();
    }
  }, [isLastStep, endTour, nextTourStep]);

  // Compute tooltip position relative to spotlight.
  // Uses explicit pixel values only -- no CSS transform, which would conflict
  // with framer-motion's own transform for the y animation.
  const getTooltipStyle = (): React.CSSProperties => {
    const tooltipWidth = 320;
    const tooltipEstimatedHeight = 170;
    const gap = 16;
    const viewportPad = 16;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (!spotlightRect) {
      // Centered card for intro/outro steps
      return {
        position: 'fixed',
        top: (vh - tooltipEstimatedHeight) / 2,
        left: (vw - tooltipWidth) / 2,
      };
    }

    const { top, left, width, height } = spotlightRect;
    const centerX = left + width / 2;
    const centerY = top + height / 2;

    // Pick initial preferred position
    let position = step?.position === 'auto' || !step?.position
      ? (centerX < vw / 2 ? 'right' : 'left')
      : step.position;

    // Fallback: if not enough room on the chosen side, try alternatives
    if (position === 'left' && left - gap - tooltipWidth < viewportPad) {
      position = left + width + gap + tooltipWidth < vw - viewportPad ? 'right' : 'bottom';
    } else if (position === 'right' && left + width + gap + tooltipWidth > vw - viewportPad) {
      position = left - gap - tooltipWidth > viewportPad ? 'left' : 'bottom';
    }

    let tooltipTop: number;
    let tooltipLeft: number;

    if (position === 'right') {
      tooltipLeft = left + width + gap;
      tooltipTop = centerY - tooltipEstimatedHeight / 2;
    } else if (position === 'left') {
      tooltipLeft = left - gap - tooltipWidth;
      tooltipTop = centerY - tooltipEstimatedHeight / 2;
    } else {
      // bottom
      tooltipTop = top + height + gap;
      tooltipLeft = centerX - tooltipWidth / 2;
    }

    // Clamp to viewport bounds
    tooltipLeft = Math.max(viewportPad, Math.min(tooltipLeft, vw - tooltipWidth - viewportPad));
    tooltipTop = Math.max(viewportPad, Math.min(tooltipTop, vh - tooltipEstimatedHeight - viewportPad));

    return {
      position: 'fixed',
      top: tooltipTop,
      left: tooltipLeft,
    };
  };

  return (
    <div className="fixed inset-0 z-[9999]">
      {/* Backdrop click to skip */}
      <div
        className="absolute inset-0"
        onClick={endTour}
        aria-hidden="true"
      />

      {/* Spotlight cutout */}
      <div
        className="absolute rounded-xl pointer-events-none"
        style={{
          top: spotlightRect?.top ?? 0,
          left: spotlightRect?.left ?? 0,
          width: spotlightRect?.width ?? 0,
          height: spotlightRect?.height ?? 0,
          boxShadow: spotlightRect
            ? '0 0 0 9999px rgba(0, 0, 0, 0.7)'
            : '0 0 0 9999px rgba(0, 0, 0, 0.7)',
          transition: `top ${TRANSITION_DURATION}ms ease, left ${TRANSITION_DURATION}ms ease, width ${TRANSITION_DURATION}ms ease, height ${TRANSITION_DURATION}ms ease`,
          // When no target, collapse spotlight to 0x0 at center so only the dark overlay shows
          ...(!spotlightRect && {
            top: '50%',
            left: '50%',
            width: 0,
            height: 0,
          }),
        }}
      />

      {/* Tooltip card */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tourStep}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="bg-card/95 backdrop-blur-md rounded-xl shadow-[0_8px_32px_-8px_rgba(0,0,0,0.3)] border border-border/50 p-5 w-[320px]"
          style={getTooltipStyle()}
        >
          <h3 className="text-base font-semibold text-foreground mb-1.5">
            {step?.title}
          </h3>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            {step?.description}
          </p>

          {/* Step indicator + navigation */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground/70">
              {tourStep + 1} of {TOUR_STEPS.length}
            </span>

            <div className="flex items-center gap-2">
              {!isFirstStep && !isLastStep && (
                <button
                  onClick={endTour}
                  className="text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors duration-150 px-2 py-1"
                >
                  Skip
                </button>
              )}

              {!isFirstStep && (
                <button
                  onClick={prevTourStep}
                  className="h-[30px] px-3 bg-muted/60 text-foreground rounded-[10px] text-sm font-medium hover:bg-muted active:scale-[0.97] transition-all duration-200"
                >
                  Back
                </button>
              )}

              <button
                onClick={handleNext}
                className="h-[30px] px-3 bg-primary text-primary-foreground rounded-[10px] text-sm font-medium hover:brightness-110 active:scale-[0.97] transition-all duration-200"
              >
                {isLastStep ? 'Done' : isFirstStep ? "Let's Go" : 'Next'}
              </button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
