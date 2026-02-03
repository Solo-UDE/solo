import type { FC, SVGProps } from 'react';

interface GeminiLogoProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

export const GeminiLogo: FC<GeminiLogoProps> = ({ size = 16, color = '#60a9ed', className, ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={color}
    className={className}
    {...props}
  >
    <path d="M12 0C12 6.627 6.627 12 0 12c6.627 0 12 5.373 12 12 0-6.627 5.373-12 12-12-6.627 0-12-5.373-12-12Z" />
  </svg>
);
