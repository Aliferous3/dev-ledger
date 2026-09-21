import { useCallback, useEffect, useRef, useState } from 'react';
import { useIdentity, useLedger } from '../store/live';
import {
  initialsFromLogin,
  isSyncing,
  manageReposUrl,
  menuStatus,
  profileUrl,
  reconnectUrl,
} from '../ledger/accountModel.mjs';

/* Top-right account control: real GitHub avatar + @login + terminal-style
   console menu. Identity comes from /api/user via IdentityContext — safe
   presentation data only. Sync uses the store's shared /api/sync pump, so
   the UtilityBar and any other surface see the same state. */

function Avatar({ url, login, size = 24 }: { url?: string; login?: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const cls = 'rounded-full object-cover border border-neutral-700 bg-[#0a0a0a] block';
  if (url && !failed) {
    return (
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        onError={() => setFailed(true)}
        className={cls}
        style={{ width: size, height: size }}
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="rounded-full bg-[#0a0a0a] border border-neutral-700 flex items-center justify-center mono-tag text-neutral-100 font-bold"
      style={{ width: size, height: size, fontSize: size > 24 ? 10 : 8 }}
    >
      {initialsFromLogin(login)}
    </span>
  );
}

const itemCls =
  'flex items-center gap-2 w-full text-left px-4 py-2 mono-tag text-[9px] tracking-[0.18em] text-neutral-500 hover:text-neutral-200 hover:bg-neutral-900/60 focus:text-neutral-200 focus:bg-neutral-900/60 focus:outline-none transition-colors';
const caret = <span aria-hidden className="text-neutral-700">&gt;</span>;

export function AccountMenu() {
  const me = useIdentity();
  const { dash, live, syncNow, pumping } = useLedger();
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const login = me?.user?.githubLogin || '';
  const avatarUrl = me?.user?.avatarUrl;

  const syncStatus = dash.sync.status;
  const revoked = live && (syncStatus === 'revoked' || dash.github?.revoked === true);
  const syncing = isSyncing(syncStatus) || pumping;
  const statusLine = revoked
    ? 'GITHUB ACCESS REVOKED'
    : menuStatus({ status: syncing ? 'syncing' : syncStatus });

  const close = useCallback(() => {
    setOpen(false);
    setSettingsOpen(false);
    setConfirmDelete(false);
  }, []);

  // Outside click + Escape close; Escape returns focus to the trigger.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  // Focus the first menu item on open; ArrowUp/Down rove between items.
  useEffect(() => {
    if (!open) return;
    const items = () =>
      Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
      ).filter((el) => !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true');
    items()[0]?.focus();
    const menu = menuRef.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
      const list = items();
      if (!list.length) return;
      e.preventDefault();
      const i = list.indexOf(document.activeElement as HTMLElement);
      const next =
        e.key === 'Home' ? 0
        : e.key === 'End' ? list.length - 1
        : e.key === 'ArrowDown' ? (i + 1) % list.length
        : (i - 1 + list.length) % list.length;
      list[next]?.focus();
    };
    menu?.addEventListener('keydown', onKey);
    return () => menu?.removeEventListener('keydown', onKey);
  }, [open, settingsOpen]);

  const deleteData = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      const res = await fetch('/api/user?confirm=1', { method: 'DELETE', credentials: 'same-origin' });
      if (res.ok) window.location.href = '/';
      else setDeleting(false);
    } catch {
      setDeleting(false);
    }
  };

  // No resolved identity (API-less preview): neutral placeholder, no fake user.
  if (!me || !login) {
    return (
      <span className="flex items-center gap-2.5 whitespace-nowrap" aria-label="no active session">
        <span className="w-6 h-6 rounded-full border border-neutral-800 bg-[#0a0a0a] flex items-center justify-center mono-tag text-[8px] text-neutral-700">··</span>
        <span className="mono-tag text-[10px] text-neutral-600 tracking-[0.12em]">@—</span>
      </span>
    );
  }

  const profile = profileUrl(login);
  const manageUrl = manageReposUrl(me);

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`account menu — @${login}`}
        onClick={() => (open ? close() : setOpen(true))}
        className="group flex items-center gap-2.5 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-[#d6ff3e]/40"
      >
        <span className="relative shrink-0">
          <span className="absolute -inset-[2px] rounded-full bg-[conic-gradient(from_180deg,#d6ff3e,#38bdf8,#f97316,#d6ff3e)] opacity-80 group-hover:opacity-100 transition-opacity spin-slower" />
          <span className="relative block group-hover:brightness-110 transition">
            <Avatar url={avatarUrl} login={login} size={24} />
          </span>
        </span>
        <span className="mono-tag text-[10px] text-neutral-200 group-hover:text-[#d6ff3e] transition-colors tracking-[0.12em] max-w-[9rem] truncate" title={`@${login}`}>
          @{login}
        </span>
        <span
          aria-hidden
          className={`text-[8px] text-neutral-600 group-hover:text-[#d6ff3e] transition-all duration-200 ${open ? 'rotate-180' : ''}`}
        >
          ▾
        </span>
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="account"
          className="absolute right-0 top-full mt-3 w-60 max-w-[calc(100vw-1rem)] bg-[#131413] border border-neutral-800 z-50 max-md:fixed max-md:right-2"
        >
          {/* identity header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-800/70">
            <Avatar url={avatarUrl} login={login} size={28} />
            <div className="min-w-0">
              <div className="mono-tag text-[10px] text-neutral-200 tracking-[0.12em] truncate">@{login}</div>
              <div className={`mono-tag text-[8px] tracking-[0.18em] mt-0.5 ${revoked ? 'text-amber-500/90' : 'text-neutral-600'}`}>
                {statusLine}
              </div>
            </div>
          </div>

          {/* actions */}
          <div className="py-1">
            {profile && (
              <a role="menuitem" href={profile} target="_blank" rel="noopener noreferrer" className={itemCls} onClick={close}>
                {caret}VIEW GITHUB PROFILE
              </a>
            )}
            {revoked ? (
              <a role="menuitem" href={reconnectUrl()} className={`${itemCls} text-amber-500/80 hover:text-amber-400`} onClick={close}>
                {caret}RECONNECT GITHUB
              </a>
            ) : (
              <button
                role="menuitem"
                type="button"
                disabled={syncing}
                aria-disabled={syncing}
                onClick={() => { if (!syncing) { syncNow(); close(); } }}
                className={`${itemCls} ${syncing ? 'text-neutral-700 cursor-wait' : ''}`}
              >
                {caret}{syncing ? 'SYNCING…' : 'SYNC NOW'}
              </button>
            )}
            {manageUrl && (
              <a role="menuitem" href={manageUrl} target="_blank" rel="noopener noreferrer" className={itemCls} onClick={close}>
                {caret}MANAGE REPOSITORIES
              </a>
            )}
            <button
              role="menuitem"
              type="button"
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen((v) => !v)}
              className={itemCls}
            >
              {caret}ACCOUNT SETTINGS
            </button>
            {settingsOpen && (
              <div className="mx-3 mb-2 border border-neutral-800/70 bg-[#0a0a0a] px-3 py-2.5">
                <div className="mono-tag text-[8px] tracking-[0.18em] text-neutral-600 leading-relaxed">
                  SESSION · {me?.authenticated ? 'AUTHENTICATED' : '—'}<br />
                  REPOSITORY ACCESS IS MANAGED ON GITHUB.
                </div>
                {confirmDelete ? (
                  <div className="mt-2.5">
                    <div className="mono-tag text-[8px] tracking-[0.18em] text-red-400/90">DELETE ALL DEV LEDGER DATA?</div>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={deleteData}
                        disabled={deleting}
                        className="mono-tag text-[8px] tracking-[0.16em] px-2 py-1 border border-red-500/50 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                      >
                        {deleting ? 'DELETING…' : 'CONFIRM'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        className="mono-tag text-[8px] tracking-[0.16em] px-2 py-1 border border-neutral-800 text-neutral-500 hover:text-neutral-300 transition-colors"
                      >
                        CANCEL
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="mt-2.5 mono-tag text-[8px] tracking-[0.16em] text-red-500/70 hover:text-red-400 transition-colors"
                  >
                    ! DELETE MY DATA
                  </button>
                )}
              </div>
            )}
          </div>

          {/* sign out — existing logout route clears session & persistent variants */}
          <div className="border-t border-neutral-800/70 py-1">
            <a role="menuitem" href="/api/auth/logout" className={`${itemCls} text-neutral-400`}>
              {caret}SIGN OUT
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
