import { useEffect, useId, useRef, useState } from "react";
import { X, ChevronDown } from "lucide-react";
import { adminInputCls } from "./styles";

/** Label + control wrapper used everywhere in the admin forms. */
export function Field({ label, hint, children, className = "" }) {
  const id = useId();
  const Label = typeof children === "function" ? "label" : "span";
  return (
    <div className={className}>
      <Label htmlFor={typeof children === "function" ? id : undefined} className="block text-[11px] font-bold uppercase tracking-wider text-ink/55 mb-1.5">
        {label}
      </Label>
      {typeof children === "function" ? children(id) : children}
      {hint && <p className="text-[11px] text-ink/45 mt-1.5 leading-snug">{hint}</p>}
    </div>
  );
}

export function TextInput({ label, hint, className = "", ...props }) {
  return (
    <Field label={label} hint={hint} className={className}>
      {(id) => <input id={id} className={adminInputCls} {...props} />}
    </Field>
  );
}

export function SelectInput({ label, hint, options, emptyLabel, className = "", ...props }) {
  return (
    <Field label={label} hint={hint} className={className}>
      {(id) => (
        <select id={id} className={`${adminInputCls} appearance-none pr-9 bg-no-repeat`} {...props}>
          {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
          {options.map((o) => <option key={o}>{o}</option>)}
        </select>
      )}
    </Field>
  );
}

/**
 * Bottom sheet on phones, centred panel on larger screens. Locks page scroll,
 * closes on Escape or a tap on the dark backdrop, and is portalled-free but
 * fixed to the viewport (no transformed ancestors in the admin pages).
 */
export function Sheet({ title, subtitle, accent, onClose, children, footer, maxWidth = "max-w-2xl" }) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", onKey);
    const body = document.body;
    const prev = body.style.overflow;
    const sbw = window.innerWidth - document.documentElement.clientWidth;
    const prevPad = body.style.paddingRight;
    body.style.overflow = "hidden";
    if (sbw > 0) body.style.paddingRight = `${sbw}px`;
    return () => {
      window.removeEventListener("keydown", onKey);
      body.style.overflow = prev;
      body.style.paddingRight = prevPad;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-ink/60 flex items-end sm:items-center justify-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`bg-surface w-full ${maxWidth} max-h-[94dvh] sm:max-h-[90dvh] rounded-t-[1.75rem] sm:rounded-[1.75rem] shadow-2xl flex flex-col animate-step`}
        style={{ "--accent": accent }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4 border-b border-ink/[0.07]">
          <div className="min-w-0">
            <h2 className="font-display font-bold text-[1.25rem] leading-tight text-ink truncate">{title}</h2>
            {subtitle && <p className="text-xs text-ink/55 mt-1 truncate">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 w-10 h-10 rounded-full bg-ink/5 hover:bg-ink/10 flex items-center justify-center transition-colors"
          >
            <X size={18} className="text-ink/70" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5">{children}</div>
        {footer && (
          <div className="px-5 pt-3 border-t border-ink/[0.07]" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/** Collapsible section so a long lead form is a short list of headings. */
export function Section({ title, badge, defaultOpen = false, children }) {
  return (
    <details open={defaultOpen} className="group rounded-2xl border border-ink/10 bg-white mt-3 first:mt-0">
      <summary className="list-none cursor-pointer select-none flex items-center justify-between gap-3 px-4 py-3.5 [&::-webkit-details-marker]:hidden">
        <span className="font-display font-bold text-[15px] text-ink">
          {title}
          {badge ? <span className="ml-2 text-[11px] font-bold text-ink/50 bg-ink/5 rounded-full px-2 py-0.5 align-middle">{badge}</span> : null}
        </span>
        <ChevronDown size={18} className="text-ink/40 transition-transform group-open:rotate-180" />
      </summary>
      <div className="px-4 pb-4 pt-1">{children}</div>
    </details>
  );
}

/** A chip you can switch on and off (status filters, gallery field toggles). */
export function Chip({ active, onClick, children, dot, className = "" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 h-9 px-3.5 rounded-full text-[13px] font-semibold border flex items-center gap-1.5 transition-colors ${
        active ? "bg-ink text-white border-ink" : "bg-surface text-ink/70 border-ink/15 hover:border-ink/40"
      } ${className}`}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: active ? "#fff" : dot }} />}
      {children}
    </button>
  );
}

const MANUAL_VALUE = "__manual__";

/**
 * A dropdown that also lets the admin type their own value when none of the
 * options fit (e.g. a property age of "3 years", or a one-off approval type).
 * A saved value that isn't in the list opens straight into the typing box, so
 * custom values are never lost or silently reset on the next edit.
 */
export function ManualSelect({ label, hint, options, value, onChange, emptyLabel = "— not set —", manualLabel = "Other (type manually)", placeholder = "Type it here", className = "" }) {
  const current = value ?? "";
  const isCustom = current !== "" && !options.includes(current);
  const [manual, setManual] = useState(isCustom);
  const inputRef = useRef(null);
  const focusNext = useRef(false);
  const showInput = manual || isCustom;

  useEffect(() => {
    if (showInput && focusNext.current) {
      focusNext.current = false;
      inputRef.current?.focus();
    }
  }, [showInput]);

  function handleSelect(e) {
    const v = e.target.value;
    if (v === MANUAL_VALUE) {
      focusNext.current = true;
      // Start from an empty box so the old list choice isn't mistaken for a typed one.
      if (!isCustom) onChange("");
      setManual(true);
      return;
    }
    setManual(false);
    onChange(v);
  }

  return (
    <Field label={label} hint={hint} className={className}>
      {(id) => (
        <>
          <select id={id} className={`${adminInputCls} appearance-none pr-9 bg-no-repeat`} value={showInput ? MANUAL_VALUE : current} onChange={handleSelect}>
            <option value="">{emptyLabel}</option>
            {options.map((o) => <option key={o}>{o}</option>)}
            <option value={MANUAL_VALUE}>{manualLabel}</option>
          </select>
          {showInput && (
            <input
              ref={inputRef}
              className={`${adminInputCls} mt-2`}
              aria-label={`${label} (typed manually)`}
              placeholder={placeholder}
              value={current}
              onChange={(e) => onChange(e.target.value)}
            />
          )}
        </>
      )}
    </Field>
  );
}
