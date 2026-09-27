import type { ReactNode } from 'react';

export interface LegalSectionRef {
  id: string;
  num: string;
  name: string;
}

const linkCls =
  'text-neutral-500 hover:text-[#d6ff3e] focus-visible:text-[#d6ff3e] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#d6ff3e]/40 transition-colors';

export function LegalSection({
  id,
  num,
  title,
  children,
}: {
  id: string;
  num: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24">
      <div className="border-b border-neutral-900 pb-3 mb-6">
        <div className="mono-tag text-[9px] text-[#d6ff3e]/80 tracking-[0.28em] mb-1.5" aria-hidden>
          {num} / LEGAL RECORD
        </div>
        <h2 id={`${id}-title`} className="font-editorial font-light text-2xl md:text-3xl text-neutral-100 scroll-mt-24">
          {title}
        </h2>
      </div>
      <div className="space-y-4 text-sm md:text-[15px] text-neutral-400 leading-relaxed max-w-[62ch]">
        {children}
      </div>
    </section>
  );
}

export function LegalPageShell({
  title,
  subtitle,
  effective,
  sections,
  children,
}: {
  title: string;
  subtitle: string;
  effective: string;
  sections: LegalSectionRef[];
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-100 flex flex-col selection:bg-[#d6ff3e]/30 selection:text-white">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{ background: 'radial-gradient(ellipse 75% 45% at 50% 22%, rgba(214,255,62,0.04), transparent 70%)' }}
      />

      <div className="relative flex items-center justify-between px-4 md:px-6 py-2.5 border-b border-neutral-900 bg-[#0e0e0e]">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#2a2a2a]" />
          <span className="w-2 h-2 rounded-full bg-[#2a2a2a]" />
          <span className="w-2 h-2 rounded-full bg-[#d6ff3e] orb-pulse" />
          <span className="mono-tag text-[9px] text-neutral-400 ml-3">dev-ledger — legal — public</span>
        </div>
        <div className="mono-tag text-[9px] text-neutral-600 hidden sm:flex items-center gap-3">
          <span>LEGAL RECORD</span>
          <span className="text-[#d6ff3e]">● PUBLIC DOCUMENT</span>
        </div>
      </div>

      <div className="relative flex-1 w-full max-w-[880px] mx-auto px-5 md:px-8 py-10 md:py-14">
        <a href="/" className={`mono-tag text-[9px] tracking-[0.22em] ${linkCls}`}>
          &lt; RETURN TO DEV LEDGER
        </a>

        <header className="mt-8 mb-12">
          <div className="mono-tag text-[9px] tracking-[0.28em] text-[#d6ff3e] mb-3">DEV LEDGER</div>
          <h1 className="font-editorial font-light text-[clamp(2.2rem,6vw,4.4rem)] leading-[0.95]">{title}</h1>
          <p className="font-editorial italic text-sm md:text-base text-neutral-400 mt-4 max-w-[58ch]">{subtitle}</p>
          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-1 mono-tag text-[8px] tracking-[0.2em] text-neutral-600">
            <span>DOCUMENT · LEGAL RECORD</span>
            <span className="text-neutral-800">·</span>
            <span>EFFECTIVE {effective}</span>
            <span className="text-neutral-800">·</span>
            <span>PUBLIC DOCUMENT</span>
          </div>
        </header>

        <nav aria-label="Sections" className="mb-14 border border-neutral-900 bg-[#0c0c0c]/80 px-4 py-3">
          <ol className="grid sm:grid-cols-2 gap-x-8 gap-y-1.5">
            {sections.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className={`mono-tag text-[9px] tracking-[0.16em] flex gap-3 py-0.5 ${linkCls}`}
                >
                  <span className="text-neutral-700">{section.num}</span>
                  <span>{section.name}</span>
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="mb-14 flex flex-wrap gap-x-6 gap-y-2 mono-tag text-[8px] tracking-[0.16em] text-neutral-700">
          <a href="/privacy" className={linkCls}>PRIVACY POLICY</a>
          <span className="text-neutral-800">·</span>
          <a href="/terms" className={linkCls}>TERMS OF SERVICE</a>
          <span className="text-neutral-800">·</span>
          <a href="/security" className={linkCls}>SECURITY &amp; PRIVACY</a>
        </div>

        <main className="space-y-14">{children}</main>

        <div className="mt-16 pt-6 border-t border-neutral-900 flex items-center justify-between gap-4">
          <a href="/" className={`mono-tag text-[9px] tracking-[0.22em] ${linkCls}`}>
            &lt; RETURN TO DEV LEDGER
          </a>
          <span className="mono-tag text-[8px] tracking-[0.2em] text-neutral-700">END OF RECORD</span>
        </div>
      </div>
    </div>
  );
}
