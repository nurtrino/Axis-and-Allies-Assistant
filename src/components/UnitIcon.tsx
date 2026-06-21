import React from "react";

/**
 * Clean silhouette icons for the 13 Anniversary unit types. Each draws in
 * `currentColor` so it can be tinted by coalition/side. viewBox is 0 0 64 64.
 */

const paths: Record<string, React.ReactNode> = {
  // Infantry — plain stick figure: circle head, body, two arms, two legs.
  infantry: (
    <g stroke="currentColor" fill="none" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="32" cy="15" r="6.5" fill="currentColor" stroke="none" />
      <path d="M32 21.5V42" />
      <path d="M32 27 22 37" />
      <path d="M32 27 42 37" />
      <path d="M32 42 23 56" />
      <path d="M32 42 41 56" />
    </g>
  ),
  // Field artillery — howitzer with a long angled barrel and two wheels.
  artillery: (
    <>
      <path d="M10 44h30l18-18-3-3-17 13H12z" />
      <circle cx="18" cy="50" r="7" />
      <circle cx="36" cy="50" r="7" />
      <rect x="6" y="42" width="34" height="5" rx="2" />
    </>
  ),
  // Tank — hull, tracks, turret and gun.
  tank: (
    <>
      <rect x="6" y="34" width="52" height="14" rx="4" />
      <circle cx="14" cy="48" r="6" />
      <circle cx="26" cy="48" r="6" />
      <circle cx="38" cy="48" r="6" />
      <circle cx="50" cy="48" r="6" />
      <path d="M22 34v-7a6 6 0 0 1 6-6h10a6 6 0 0 1 6 6v7Z" />
      <rect x="40" y="24" width="22" height="4" rx="2" />
    </>
  ),
  // Antiaircraft gun — twin barrels angled to the sky on a mount.
  aaGun: (
    <>
      <path d="M18 52h28l-4-12H22z" />
      <rect x="28" y="36" width="8" height="8" />
      <rect x="30" y="8" width="3.5" height="30" rx="1.5" transform="rotate(20 30 38)" />
      <rect x="34" y="8" width="3.5" height="30" rx="1.5" transform="rotate(20 34 38)" />
      <circle cx="32" cy="40" r="4" />
    </>
  ),
  // Industrial complex — factory block with two smokestacks and a sawtooth roof.
  factory: (
    <>
      <rect x="8" y="30" width="48" height="26" />
      <path d="M8 30l8-8v8zM20 30l8-8v8zM32 30l8-8v8z" />
      <rect x="44" y="10" width="5" height="20" />
      <rect x="51" y="14" width="5" height="16" />
      <rect x="16" y="40" width="8" height="16" />
      <rect x="32" y="40" width="8" height="10" />
    </>
  ),
  // Fighter — sleek single plane, top view.
  fighter: (
    <>
      <path d="M30 6h4l2 18 22 8v5l-22-4 0 12 8 5v4l-12-3-12 3v-4l8-5 0-12-22 4v-5l22-8 2-18Z" />
    </>
  ),
  // Bomber — larger plane with broad swept wings and engine nacelles.
  bomber: (
    <>
      <path d="M30 4h4l3 16 23 12v5l-23-6v8l-2 2 12 7v4l-15-4-15 4v-4l12-7-2-2v-8L4 37v-5l23-12 3-16Z" />
      <rect x="14" y="26" width="5" height="6" rx="1" />
      <rect x="45" y="26" width="5" height="6" rx="1" />
    </>
  ),
  // Battleship — long hull with two big gun turrets and a tower.
  battleship: (
    <>
      <path d="M4 40h56l-6 12H10z" />
      <rect x="14" y="30" width="36" height="8" rx="2" />
      <rect x="28" y="18" width="8" height="14" />
      <rect x="18" y="26" width="10" height="5" rx="2" />
      <rect x="36" y="26" width="10" height="5" rx="2" />
      <rect x="14" y="24" width="8" height="3" rx="1.5" transform="rotate(-12 14 24)" />
      <rect x="42" y="24" width="8" height="3" rx="1.5" transform="rotate(12 50 24)" />
    </>
  ),
  // Aircraft carrier — flat deck with island and a plane on top.
  carrier: (
    <>
      <path d="M2 42h60l-6 11H8z" />
      <rect x="6" y="34" width="52" height="8" rx="2" />
      <rect x="40" y="24" width="8" height="10" />
      <path d="M22 26h4l1 6 8 3v2l-8-1v3l3 2v2l-5-1-5 1v-2l3-2v-3l-8 1v-2l8-3 1-6Z" />
    </>
  ),
  // Cruiser — mid-size warship, single main turret and tower.
  cruiser: (
    <>
      <path d="M6 41h52l-6 11H12z" />
      <rect x="16" y="32" width="32" height="7" rx="2" />
      <rect x="29" y="20" width="6" height="12" />
      <rect x="22" y="28" width="9" height="4" rx="2" />
      <rect x="24" y="24" width="7" height="3" rx="1.5" transform="rotate(-14 24 24)" />
    </>
  ),
  // Destroyer — small fast warship with a raked funnel.
  destroyer: (
    <>
      <path d="M8 42h48l-6 10H14z" />
      <rect x="20" y="34" width="24" height="6" rx="2" />
      <rect x="30" y="24" width="5" height="10" />
      <path d="M24 34l4-10 3 1-3 9z" />
    </>
  ),
  // Submarine — cigar hull with conning tower and periscope.
  submarine: (
    <>
      <path d="M8 38a24 8 0 0 0 48 0 24 8 0 0 0-48 0Z" />
      <rect x="28" y="24" width="8" height="10" rx="2" />
      <rect x="31" y="16" width="2.5" height="9" />
      <circle cx="14" cy="38" r="2.5" fill="#0a0a0a" />
    </>
  ),
  // Transport — broad cargo hull stacked with containers.
  transport: (
    <>
      <path d="M4 42h56l-7 11H11z" />
      <rect x="12" y="28" width="40" height="14" />
      <rect x="15" y="31" width="10" height="8" />
      <rect x="27" y="31" width="10" height="8" />
      <rect x="39" y="31" width="10" height="8" />
    </>
  ),
};

export default function UnitIcon({
  unitKey,
  size = 36,
  className,
  title,
}: {
  unitKey: string;
  size?: number;
  className?: string;
  title?: string;
}) {
  const body = paths[unitKey];
  if (!body) return null;
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
      role="img"
      aria-label={title ?? unitKey}
    >
      {title ? <title>{title}</title> : null}
      {body}
    </svg>
  );
}
