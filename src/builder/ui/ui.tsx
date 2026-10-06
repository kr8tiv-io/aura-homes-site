"use client";

/* Editor primitives for the builder.

   Deliberately small and boring. Classes live in builder-ui.css and follow
   the site: Obsidian, Alabaster, Bronze, hairline rules. There is not a
   literal colour in this file. */

import type { ReactNode } from "react";
import "../../styles/builder-ui.css";

export function Panel({
  label,
  hint,
  right,
  children,
  className = "",
}: {
  label: string;
  hint?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`b-panel ${className}`}>
      <div className="b-panel-head">
        <p className="b-label">{label}</p>
        {right}
      </div>
      {hint ? <p className="b-hint">{hint}</p> : null}
      <div className="b-panel-body">{children}</div>
    </section>
  );
}

export function Stat({ k, v, sub }: { k: string; v: ReactNode; sub?: ReactNode }) {
  return (
    <div className="b-stat">
      <p className="b-label">{k}</p>
      <p className="b-stat-value">{v}</p>
      {sub ? <p className="b-stat-sub">{sub}</p> : null}
    </div>
  );
}

export function Button({
  children,
  onClick,
  tone = "quiet",
  disabled,
  title,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: "loud" | "quiet" | "danger";
  disabled?: boolean;
  title?: string;
  type?: "button" | "submit";
}) {
  const toneClass = tone === "loud" ? " is-loud" : tone === "danger" ? " is-danger" : "";
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} className={`b-button${toneClass}`}>
      {children}
    </button>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
  hint,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  display?: (v: number) => string;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={`b-slider${disabled ? " is-off" : ""}`}>
      <span className="b-slider-row">
        <span className="b-label">{label}</span>
        <span className="b-slider-value">{display ? display(value) : value}</span>
      </span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint ? <span className="b-slider-hint">{hint}</span> : null}
    </label>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
  columns,
}: {
  label?: string;
  value: T;
  options: ReadonlyArray<{ id: T; label: string; title?: string }>;
  onChange: (v: T) => void;
  hint?: ReactNode;
  columns?: number;
}) {
  return (
    <div>
      {label ? <p className="b-label">{label}</p> : null}
      <div
        className="b-segment"
        style={columns ? { display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
        role="group"
        aria-label={label}
      >
        {options.map((o) => {
          const on = o.id === value;
          return (
            <button key={o.id} type="button" onClick={() => onChange(o.id)} aria-pressed={on} title={o.title}>
              {o.label}
            </button>
          );
        })}
      </div>
      {hint ? <p className="b-hint">{hint}</p> : null}
    </div>
  );
}

export function TextInput({
  label,
  value,
  onChange,
  placeholder,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
}) {
  return (
    <label className="b-text">
      <span className="b-label">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export function Notice({
  title,
  items,
  foot,
}: {
  title: string;
  items: readonly string[];
  foot?: ReactNode;
}) {
  if (items.length === 0) return null;
  return (
    <div className="b-notice">
      <p className="b-label">{title}</p>
      <ul>
        {items.map((w) => (
          <li key={w}>
            <span aria-hidden="true">·</span>
            <span>{w}</span>
          </li>
        ))}
      </ul>
      {foot ? <p className="b-notice-foot">{foot}</p> : null}
    </div>
  );
}
