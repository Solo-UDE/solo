import { useCallback, useEffect, useRef, useState } from "react";

interface Star {
  x: number;
  y: number;
  z: number;
  size: number;
}

interface StarsBackgroundProps extends React.CanvasHTMLAttributes<HTMLCanvasElement> {
  count?: number;
  factor?: number;
  speed?: number;
  starColor?: string;
  pointerEvents?: boolean;
  className?: string;
}

function createStars(count: number, width: number, height: number): Star[] {
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: Math.random() * width,
      y: Math.random() * height,
      z: Math.random(),
      size: 0.5 + Math.random() * 2,
    });
  }
  return stars;
}

export function StarsBackground({
  count = 200,
  factor = 0.05,
  speed = 50,
  starColor = "#fff",
  pointerEvents = true,
  className,
  ...props
}: StarsBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const starsRef = useRef<Star[]>([]);
  const mouseRef = useRef({ x: 0, y: 0 });
  const rafRef = useRef<number>(0);
  const [isDark, setIsDark] = useState(() =>
    document.documentElement.classList.contains("dark")
  );

  const drawStars = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      ctx.clearRect(0, 0, width, height);
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;

      for (const star of starsRef.current) {
        const offsetX = (mx - width / 2) * factor * star.z;
        const offsetY = (my - height / 2) * factor * star.z;
        const sx = star.x + offsetX;
        const sy = star.y + offsetY;

        ctx.globalAlpha = 0.3 + 0.7 * star.z;
        ctx.fillStyle = starColor;
        ctx.beginPath();
        ctx.arc(sx, sy, star.size * (0.5 + 0.5 * star.z), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
    [factor, starColor]
  );

  useEffect(() => {
    const html = document.documentElement;
    const observer = new MutationObserver(() => {
      setIsDark(html.classList.contains("dark"));
    });
    observer.observe(html, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isDark) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const parent = canvas.parentElement ?? document.body;

    const resize = () => {
      const rect = parent.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      starsRef.current = createStars(count, rect.width, rect.height);
    };

    resize();

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(parent);

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    canvas.addEventListener("mousemove", handleMouseMove);

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    if (prefersReducedMotion) {
      drawStars(ctx, canvas.width / (window.devicePixelRatio || 1), canvas.height / (window.devicePixelRatio || 1));
      return () => {
        canvas.removeEventListener("mousemove", handleMouseMove);
        resizeObserver.disconnect();
      };
    }

    let lastTime = 0;

    const animate = (time: number) => {
      const delta = lastTime ? (time - lastTime) / 1000 : 0;
      lastTime = time;

      const w = canvas.width / (window.devicePixelRatio || 1);
      const h = canvas.height / (window.devicePixelRatio || 1);

      for (const star of starsRef.current) {
        star.y += delta * speed * (0.2 + 0.8 * star.z);
        if (star.y > h + star.size) {
          star.y = -star.size;
          star.x = Math.random() * w;
        }
      }

      drawStars(ctx, w, h);
      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafRef.current);
      canvas.removeEventListener("mousemove", handleMouseMove);
      resizeObserver.disconnect();
    };
  }, [isDark, count, speed, factor, starColor, drawStars]);

  if (!isDark) return null;

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ pointerEvents: pointerEvents ? "auto" : "none" }}
      {...props}
    />
  );
}
