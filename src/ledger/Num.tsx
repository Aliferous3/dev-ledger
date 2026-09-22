import NumberFlow, { NumberFlowGroup } from '@number-flow/react';
import type { ComponentProps } from 'react';

/* NUM — Dev Ledger's animated number surface over @number-flow/react.
   Restrained transform grammar: ~650ms digit spin/layout, 280ms char fade,
   ease-out, no spring. trend={0} animates change without assigning
   sentiment ("up" is not good, "down" is not bad). Reduced motion is
   honored by NumberFlow itself (respectMotionPreference defaults true);
   tabular-nums keeps layout stable as digits cycle.

   Callers pass the RAW number — formatting lives here / via Intl options
   so transitions always run old → new, never through a placeholder zero. */

export const NUM_TRANSFORM_TIMING = {
  duration: 650,
  easing: 'cubic-bezier(0.22, 0, 0.36, 1)',
} as const;
export const NUM_SPIN_TIMING = NUM_TRANSFORM_TIMING;
export const NUM_OPACITY_TIMING = {
  duration: 280,
  easing: 'ease-out',
} as const;

type NumFormat = ComponentProps<typeof NumberFlow>['format'];

type Base = {
  value: number;
  format?: NumFormat;
  prefix?: string;
  suffix?: string;
  className?: string;
  style?: React.CSSProperties;
  locales?: string;
  animated?: boolean;
};

const shared = {
  trend: 0,
  transformTiming: NUM_TRANSFORM_TIMING,
  spinTiming: NUM_SPIN_TIMING,
  opacityTiming: NUM_OPACITY_TIMING,
} satisfies Partial<ComponentProps<typeof NumberFlow>>;

export function Num({ value, format, prefix, suffix, className, style, locales, animated }: Base) {
  return (
    <NumberFlow
      {...shared}
      value={value}
      format={format}
      prefix={prefix}
      suffix={suffix}
      locales={locales ?? 'en-US'}
      animated={animated}
      className={className}
      style={{ fontVariantNumeric: 'tabular-nums', ...style }}
    />
  );
}

/* Grouped thousands — the ledger's default metric format (1,747,415). */
export function NumGrouped(props: Omit<Base, 'format'>) {
  return <Num {...props} format={{ useGrouping: true }} />;
}

/* Compact notation — matches fmtCompact() output (2.1M / 24.6K). */
export function NumCompact(props: Omit<Base, 'format'>) {
  return (
    <Num
      {...props}
      format={{ notation: 'compact', maximumFractionDigits: 1 }}
    />
  );
}

/* Percentage — caller passes the 0–100 number (73 → "73%"). */
export function NumPct({ value, ...rest }: Base) {
  return <Num {...rest} value={value} suffix="%" format={{ maximumFractionDigits: 1 }} />;
}

/* Byte magnitudes — NumberFlow needs a static suffix, so the unit is
   resolved first and the scaled value animates (same result the eye sees
   as fmtBytes(): "1.7 MB"). */
export function NumBytes({ value, ...rest }: Base) {
  const scaled =
    value >= 1_000_000 ? { v: value / 1_000_000, s: ' MB' }
    : value >= 1_000 ? { v: value / 1_000, s: ' KB' }
    : { v: value, s: ' B' };
  return (
    <Num
      {...rest}
      value={scaled.v}
      suffix={scaled.s}
      format={{ maximumFractionDigits: scaled.s === ' B' ? 0 : 1 }}
    />
  );
}

export { NumberFlowGroup };
