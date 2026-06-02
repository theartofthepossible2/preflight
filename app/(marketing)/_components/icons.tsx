import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function Logo({ className }: { className?: string }) {
  // A "cleared for departure" mark: shield outline with an upward check.
  return (
    <svg
      className={className}
      width={28}
      height={28}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M12 2.5 4.5 5.4v6.1c0 4.6 3.1 8 7.5 9.9 4.4-1.9 7.5-5.3 7.5-9.9V5.4L12 2.5Z"
        fill="currentColor"
        fillOpacity="0.12"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <path
        d="m8.4 12.2 2.5 2.5 4.7-5.1"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <path d="m20 6-11 11-5-5" />
    </svg>
  );
}

export function IconX(props: IconProps) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function IconArrowRight(props: IconProps) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function IconArrowDown(props: IconProps) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <path d="M12 5v14M6 13l6 6 6-6" />
    </svg>
  );
}

export function IconKey(props: IconProps) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="m10.5 12.5 9-9M16 4l3 3M14 6l3 3" />
    </svg>
  );
}

export function IconDatabase(props: IconProps) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </svg>
  );
}

export function IconDoor(props: IconProps) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8M14 3l5 2v14l-5 2M14 3v18" />
      <path d="M11 12h.01" />
    </svg>
  );
}

export function IconBraces(props: IconProps) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <path d="M7 4c-1.5 0-2 1-2 2.5S5 9 3.5 9C5 9 5 10.5 5 11.5V17c0 1.5.5 3 2 3M17 4c1.5 0 2 1 2 2.5S19 9 20.5 9C19 9 19 10.5 19 11.5V17c0 1.5-.5 3-2 3" />
    </svg>
  );
}

export function IconLock(props: IconProps) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
    </svg>
  );
}

export function IconShieldHalf(props: IconProps) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <path d="M12 2.5 4.5 5.4v6.1c0 4.6 3.1 8 7.5 9.9 4.4-1.9 7.5-5.3 7.5-9.9V5.4L12 2.5Z" />
      <path d="M12 2.5v19" />
    </svg>
  );
}

export function IconGauge(props: IconProps) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <path d="M5 18a9 9 0 1 1 14 0" />
      <path d="m12 14 4-4" />
      <circle cx="12" cy="14" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconGitBranch(props: IconProps) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <circle cx="6" cy="5" r="2.5" />
      <circle cx="6" cy="19" r="2.5" />
      <circle cx="18" cy="7" r="2.5" />
      <path d="M6 7.5v9M18 9.5c0 4-4 4.5-7 5.5" />
    </svg>
  );
}
