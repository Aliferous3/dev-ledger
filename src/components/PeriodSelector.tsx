import React from 'react';
import { Period, PERIODS } from '../types';

interface PeriodSelectorProps {
  selected: Period;
  onChange: (period: Period) => void;
  className?: string;
  terminalStyle?: boolean;
}

export const PeriodSelector: React.FC<PeriodSelectorProps> = ({
  selected,
  onChange,
  className = '',
  terminalStyle = false,
}) => {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <span className="text-[10px] font-mono tracking-widest text-[#666666] uppercase">
        {terminalStyle ? '[PERIOD]' : 'PERIOD'}
      </span>
      <div className="flex items-center gap-[2px] bg-[#0d0d0d] p-[2px] border border-[#222222]">
        {PERIODS.map((period) => {
          const isActive = selected === period;
          return (
            <button
              key={period}
              onClick={() => onChange(period)}
              className={`px-2 py-[2px] text-[9px] font-mono tracking-wider transition-all cursor-pointer ${
                isActive
                  ? 'bg-[#f5f5f5] text-[#0a0a0a] font-bold shadow-sm'
                  : 'text-[#777777] hover:text-[#e0e0e0] hover:bg-[#181818]'
              }`}
            >
              {period}
            </button>
          );
        })}
      </div>
    </div>
  );
};
