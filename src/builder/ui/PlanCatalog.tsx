"use client";

/* Glass plans only. The priced catalog, the diagrams, and the model
   previews were not brought across. Choosing a plan returns a document. */

import { useMemo, useState } from "react";
import { builderDocumentFromLegacySpec, type BuilderDocument } from "../core/document";
import { GLASS_PLAN_TEMPLATES } from "../core/planCatalog.glass";
import type { PlanTemplate } from "../core/planTypes";
import { Button } from "./ui";

interface Props {
  onChoose: (document: BuilderDocument, plan: PlanTemplate) => void | Promise<void>;
  currentName: string;
}

export default function PlanCatalog({ onChoose, currentName }: Props) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(GLASS_PLAN_TEMPLATES[0]?.id ?? "");
  const plans = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return GLASS_PLAN_TEMPLATES;
    return GLASS_PLAN_TEMPLATES.filter((plan) => plan.id.includes(needle));
  }, [query]);
  const selected = plans.find((plan) => plan.id === selectedId) ?? plans[0] ?? null;

  return (
    <section className="b-panel" aria-label="Glass plans">
      <p className="b-label">Plans</p>
      <p className="b-hint">Open designs. {currentName ? `Working from ${currentName}.` : "Nothing open yet."}</p>
      <label className="b-text">
        <span className="b-label">Find a plan</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Plan id" />
      </label>
      <ul className="b-segment" role="listbox" aria-label="Glass plans">
        {plans.map((plan) => (
          <li key={plan.id}>
            <button
              type="button"
              role="option"
              aria-selected={plan.id === selected?.id}
              onClick={() => setSelectedId(plan.id)}
            >
              {plan.id}
            </button>
          </li>
        ))}
      </ul>
      {selected ? (
        <Button
          tone="loud"
          onClick={() => onChoose(builderDocumentFromLegacySpec(selected.spec), selected)}
        >
          Use this plan
        </Button>
      ) : (
        <p className="b-hint">No plan matches that search.</p>
      )}
    </section>
  );
}
