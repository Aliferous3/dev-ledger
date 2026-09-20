import React, { useState, useEffect } from 'react';
import { Terminal, Monitor, Sparkles } from 'lucide-react';

interface TopBarProps {
  scanlinesEnabled: boolean;
  onToggleScanlines: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  scanlinesEnabled,
  onToggleScanlines,
}) => {
  const [timeStr, setTimeStr] = useState('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeStr(
        now.toLocaleTimeString('en-US', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="sticky top-0 z-50 backdrop-blur-md bg-[#0a0a0a]/90 border-b border-[#1a1a1a]">
      <div className="max-w-[1280px] mx-auto px-6 md:px-12 py-3 flex items-center justify-between">
        {/* Left: Terminal Node Info */}
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-[#d6ff3e] lime-pulse" />
          <div className="flex items-center gap-2 text-[11px] font-mono tracking-widest text-[#f5f5f5]">
            <span className="font-bold">CODE METRICS</span>
            <span className="text-[#444444]">/</span>
            <span className="text-[#888888] hidden sm:inline">TERMINAL TICKER</span>
          </div>
          <span className="text-[9px] font-mono px-1.5 py-0.5 bg-[#141414] border border-[#262626] text-[#d6ff3e] hidden md:inline">
            v2.6.4_RELEASE
          </span>
        </div>

        {/* Center: Live clock */}
        <div className="hidden md:flex items-center gap-2 text-[10px] font-mono tracking-widest text-[#666666]">
          <Terminal className="w-3.5 h-3.5 text-[#555555]" />
          <span>SYS.TIME // {timeStr || '12:00:00'} UTC</span>
        </div>

        {/* Right: Quick Controls */}
        <div className="flex items-center gap-4">
          <button
            onClick={onToggleScanlines}
            title="Toggle CRT scanline overlay"
            className={`flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-mono tracking-wider border transition-all cursor-pointer ${
              scanlinesEnabled
                ? 'border-[#d6ff3e] text-[#d6ff3e] bg-[#d6ff3e]/10'
                : 'border-[#222222] text-[#666666] hover:text-[#e0e0e0] hover:border-[#444444]'
            }`}
          >
            <Monitor className="w-3 h-3" />
            <span className="hidden sm:inline">CRT SCANLINES</span>
            <span className="text-[8px] font-bold">[{scanlinesEnabled ? 'ON' : 'OFF'}]</span>
          </button>

          <div className="flex items-center gap-1.5 text-[10px] font-mono text-[#888888]">
            <Sparkles className="w-3 h-3 text-[#d6ff3e]" />
            <span className="hidden sm:inline">ALL OBS. SYNCED</span>
          </div>
        </div>
      </div>
    </header>
  );
};
