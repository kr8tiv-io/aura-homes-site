"use client";

/* The live read-out. Floor, footprint, ridge, and how many rooms.
   Cost bands, parcel fit, and readiness stayed with the old app. */

import { useMemo } from "react";
import type { BuilderDocument } from "../core/document";
import { summarizeHome } from "../core/geometry";
import { formatFeetInches } from "../core/units";
import "../../styles/builder-ui.css";

export default function LiveReadout({ document }: { document: BuilderDocument }) {
  const summary = useMemo(() => summarizeHome(document.spec), [document.spec]);
  const rooms = summary.volumes.length === 1 ? "1 room" : `${summary.volumes.length} rooms`;
  return (
    <dl className="b-readout">
      <div>
        <dt>Floor</dt>
        <dd>{Math.round(summary.totalFloorAreaSqFt)} sq ft</dd>
      </div>
      <div>
        <dt>Footprint</dt>
        <dd>{Math.round(summary.groundFootprintSqFt)} sq ft</dd>
      </div>
      <div>
        <dt>Ridge</dt>
        <dd>{formatFeetInches(summary.maxRidgeHeightFt)}</dd>
      </div>
      <div>
        <dt>Rooms</dt>
        <dd>{rooms}</dd>
      </div>
    </dl>
  );
}
