/* SHARE entry — Concept 01 TERMINAL COMMAND. A bracketed invocation in
   the header utility row: charcoal frame, off-white text, lime on
   hover/focus, inverted lime flash on press. Compact enough to sit
   between the range pills and the account control without changing the
   header's rhythm. */

export function ShareButton({
  onShare,
  disabled,
}: {
  onShare: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onShare}
      disabled={disabled}
      aria-label="Share current Dev Ledger record"
      title={disabled ? 'Share — waiting for data' : 'Share current Dev Ledger record'}
      className="group/share mono-tag text-[8px] tracking-[0.18em] px-2 py-[3px] border border-[#3a3a3a] text-[#ccc] bg-transparent transition-colors
        hover:border-[#d6ff3e] hover:text-[#d6ff3e]
        focus:outline-none focus-visible:border-[#d6ff3e] focus-visible:text-[#d6ff3e] focus-visible:ring-1 focus-visible:ring-[#d6ff3e]
        active:bg-[#d6ff3e] active:text-black active:border-[#d6ff3e]
        disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-[#3a3a3a] disabled:hover:text-[#ccc]"
    >
      <span aria-hidden>[</span>
      <span aria-hidden className="inline-block transition-transform duration-150 group-hover/share:translate-x-[2px] group-hover/share:-translate-y-[2px] group-active/share:translate-x-0 group-active/share:translate-y-0">
        {' ↗'}
      </span>
      <span aria-hidden className="hidden sm:inline"> SHARE</span>
      <span aria-hidden> ]</span>
    </button>
  );
}
