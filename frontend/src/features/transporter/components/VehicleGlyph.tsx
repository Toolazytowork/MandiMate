import { cn } from '@/lib/cn';
import type { VehicleType } from '@/types/api';

interface Shape {
  /** Left edge of the cargo body. */
  boxX: number;
  /** Top of the cargo body (lower = taller). */
  boxTop: number;
  /** Left edge of the cab. */
  cabX: number;
  bed: 'box' | 'open';
  reefer?: boolean;
  tandem?: boolean;
}

const SHAPES: Record<VehicleType, Shape> = {
  mini_truck: { boxX: 36, boxTop: 30, cabX: 70, bed: 'box' },
  pickup: { boxX: 28, boxTop: 38, cabX: 68, bed: 'open' },
  light_truck: { boxX: 20, boxTop: 22, cabX: 74, bed: 'box' },
  medium_truck: { boxX: 6, boxTop: 16, cabX: 82, bed: 'box', tandem: true },
  reefer_truck: { boxX: 12, boxTop: 18, cabX: 78, bed: 'box', reefer: true },
};

const INK = '#1F1913';
const GOLD = '#7C5F31';
const PAPER = '#FBF9F4';

export interface VehicleGlyphProps {
  type: VehicleType;
  /** Mute the drawing (inactive vehicles). */
  muted?: boolean;
  className?: string;
}

/** Side-view line drawing of a vehicle class on a survey-grid tile: cab, body, wheels, crates. Decorative. */
export function VehicleGlyph({ type, muted = false, className }: VehicleGlyphProps) {
  const { boxX, boxTop, cabX, bed, reefer = false, tandem = false } = SHAPES[type];
  const boxRight = cabX - 2;
  const cabRight = cabX + 26;
  const rearWheel = boxX + 13;

  return (
    <svg
      viewBox="0 0 120 64"
      aria-hidden="true"
      focusable="false"
      className={cn('h-auto w-full', muted && 'opacity-45 grayscale', className)}
    >
      {/* Road */}
      <path d="M2 58.5H118" stroke={INK} strokeOpacity="0.18" strokeWidth="1" strokeLinecap="round" />
      <path d="M10 61.5H30M44 61.5H64M78 61.5H98" stroke={GOLD} strokeOpacity="0.45" strokeWidth="1" strokeLinecap="round" />

      {/* Chassis */}
      <rect x={boxX} y="47" width={cabRight - boxX} height="4.5" rx="1" fill={PAPER} stroke={INK} strokeWidth="1" />

      {/* Cargo body */}
      {bed === 'box' ? (
        <>
          <rect x={boxX} y={boxTop} width={boxRight - boxX} height={47 - boxTop} rx="1" fill={PAPER} stroke={INK} strokeWidth="1" />
          <path d={`M${boxX + 4} ${boxTop + 5}H${boxRight - 4}`} stroke={GOLD} strokeOpacity="0.7" strokeWidth="1" strokeLinecap="round" />
          {Array.from({ length: Math.max(1, Math.floor((boxRight - boxX) / 14)) }, (_, index) => {
            const x = boxX + 7 + index * 14;
            return x < boxRight - 4 ? (
              <path key={index} d={`M${x} ${boxTop + 10}V${44}`} stroke={INK} strokeOpacity="0.12" strokeWidth="1" />
            ) : null;
          })}
        </>
      ) : (
        <>
          {/* Crates peeking over an open bed */}
          <rect x={boxX + 4} y="29" width="13" height="10" rx="1" fill={PAPER} stroke={GOLD} strokeWidth="0.9" />
          <rect x={boxX + 19} y="31" width="13" height="8" rx="1" fill={PAPER} stroke={GOLD} strokeWidth="0.9" />
          <path d={`M${boxX + 6} 33.5H${boxX + 15}M${boxX + 21} 35H${boxX + 30}`} stroke={GOLD} strokeOpacity="0.7" strokeWidth="0.9" />
          <rect x={boxX} y={boxTop} width={boxRight - boxX} height={47 - boxTop} rx="1" fill={PAPER} stroke={INK} strokeWidth="1" />
        </>
      )}

      {reefer ? (
        <>
          <rect x={boxRight - 13} y={boxTop - 6} width="10" height="6" rx="1" fill={PAPER} stroke={INK} strokeWidth="1" />
          <g transform={`translate(${(boxX + boxRight) / 2} ${(boxTop + 47) / 2 + 1})`} stroke={GOLD} strokeWidth="1" strokeLinecap="round">
            <path d="M0 -6V6M-5.2 -3L5.2 3M-5.2 3L5.2 -3" />
            <path d="M-1.6 -4.6L0 -3.2L1.6 -4.6M-1.6 4.6L0 3.2L1.6 4.6" strokeWidth="0.9" />
          </g>
        </>
      ) : null}

      {/* Cab */}
      <path
        d={`M${cabX} 47V30Q${cabX} 24 ${cabX + 6} 24H${cabX + 15}L${cabX + 23.5} 34Q${cabRight} 36.5 ${cabRight} 40V47Z`}
        fill={PAPER}
        stroke={INK}
        strokeWidth="1"
      />
      <path d={`M${cabX + 4.5} 28H${cabX + 14.2}L${cabX + 19.5} 34.5H${cabX + 4.5}Z`} fill="none" stroke={INK} strokeOpacity="0.5" strokeWidth="0.8" />
      <path d={`M${cabRight - 3} 41.5H${cabRight}`} stroke={GOLD} strokeWidth="1.2" strokeLinecap="round" />

      {/* Wheels */}
      {[rearWheel, ...(tandem ? [rearWheel + 14] : []), cabX + 15].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="52" r="6.2" fill={PAPER} stroke={INK} strokeWidth="1" />
          <circle cx={cx} cy="52" r="2.2" fill="none" stroke={GOLD} strokeWidth="0.8" />
        </g>
      ))}
    </svg>
  );
}
