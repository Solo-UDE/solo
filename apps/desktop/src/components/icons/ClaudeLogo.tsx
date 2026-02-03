import type { FC, SVGProps } from 'react';

interface ClaudeLogoProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

export const ClaudeLogo: FC<ClaudeLogoProps> = ({ size = 16, color = '#D97757', className, ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={color}
    className={className}
    {...props}
  >
    <path d="M16.091 1.832c-3.76-1.094-7.696.502-9.567 3.564L3.12 11.268C1.158 14.61 2.243 18.88 5.586 20.932l.132.078c3.463 2.09 7.947.92 10.018-2.556l3.592-6.072c2.008-3.389.867-7.77-2.517-9.788l-.72-.762ZM14.594 8.2a1.472 1.472 0 1 1 0 2.944 1.472 1.472 0 0 1 0-2.944Z" />
  </svg>
);
