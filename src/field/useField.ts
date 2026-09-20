import { useMemo, useState } from 'react';
import {
  cells,
  computeStats,
  inPeriod,
  peakCell,
  periodDayCount,
  periodRange,
  type DayCell,
  type Period,
  languages,
} from '../fieldData';

export function useField(initial: Period = '1Y') {
  const [period, setPeriod] = useState<Period>(initial);
  const [hover, setHover] = useState<DayCell | null>(null);
  const [hoverLang, setHoverLang] = useState<string | null>(null);

  const visible = useMemo(
    () => cells.filter((c) => inPeriod(c.date, period)),
    [period],
  );

  const stats = useMemo(() => computeStats(visible), [visible]);
  const peak = useMemo(() => peakCell(visible), [visible]);
  const range = useMemo(() => periodRange(period), [period]);
  const span = periodDayCount(period);

  const isDimmed = (c: DayCell) => !inPeriod(c.date, period);

  return {
    period,
    setPeriod,
    hover,
    setHover,
    hoverLang,
    setHoverLang,
    visible,
    stats,
    peak,
    range,
    span,
    isDimmed,
    languages,
    cells,
  };
}