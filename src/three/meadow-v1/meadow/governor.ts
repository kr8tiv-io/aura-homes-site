import { meadowTierRank, type MeadowTier } from "./contract";

export type MeadowFreezeReason = "long-task" | "frame-budget" | null;

export interface MeadowGovernorSnapshot {
  frozen: boolean;
  reason: MeadowFreezeReason;
  lastHealthyTier: MeadowTier | null;
  p95FrameMs: number;
  maxLongTaskMs: number;
}

export class MeadowPromotionGovernor {
  private readonly frameBudgetMs: number;
  private readonly longTaskLimitMs: number;
  private readonly schedulingToleranceMs: number;
  private readonly frames: number[] = [];
  private state: MeadowGovernorSnapshot = {
    frozen: false,
    reason: null,
    lastHealthyTier: null,
    p95FrameMs: 0,
    maxLongTaskMs: 0,
  };

  constructor(options: { frameBudgetMs: number; longTaskLimitMs: number; schedulingToleranceMs?: number }) {
    this.frameBudgetMs = options.frameBudgetMs;
    this.longTaskLimitMs = options.longTaskLimitMs;
    /* requestAnimationFrame cadence includes browser/OS scheduling noise.
       Keep the reported p95 raw, but do not call 16.8–18.2 ms cadence a GPU
       failure on a nominal 60 Hz display. */
    this.schedulingToleranceMs = options.schedulingToleranceMs ?? Math.max(1.5, this.frameBudgetMs * 0.08);
  }

  markHealthy(tier: MeadowTier): void {
    if (
      this.state.lastHealthyTier === null ||
      meadowTierRank(tier) > meadowTierRank(this.state.lastHealthyTier)
    ) {
      this.state.lastHealthyTier = tier;
    }
  }

  observeLongTask(durationMs: number): void {
    this.state.maxLongTaskMs = Math.max(this.state.maxLongTaskMs, durationMs);
    if (durationMs > this.longTaskLimitMs) this.freeze("long-task");
  }

  observeFrame(durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 250) return;
    this.frames.push(durationMs);
    if (this.frames.length > 60) this.frames.shift();
    const sorted = [...this.frames].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
    this.state.p95FrameMs = sorted[index] ?? 0;
    /* A handful of rAF intervals is dominated by browser/OS scheduling and
       tab activation. Judge a sustained one-second-ish sample instead: six
       genuinely slow frames still fail p95, while a short compositor burst
       cannot strand the meadow at its first two pages. */
    if (
      this.frames.length >= 60 &&
      this.state.p95FrameMs > this.frameBudgetMs + this.schedulingToleranceMs
    ) {
      this.freeze("frame-budget");
    }
  }

  canAccept(tier: MeadowTier): boolean {
    if (!this.state.frozen) return true;
    return this.state.lastHealthyTier !== null && meadowTierRank(tier) <= meadowTierRank(this.state.lastHealthyTier);
  }

  /** The first composed near meadow is an intentional seed phase. Start the
   * promotion sample after it so shader/loader startup cadence cannot poison
   * the sustained health window used for mid and far tiles. */
  resetFrameSample(): void {
    this.frames.length = 0;
    this.state.p95FrameMs = 0;
  }

  snapshot(): MeadowGovernorSnapshot {
    return { ...this.state };
  }

  private freeze(reason: Exclude<MeadowFreezeReason, null>): void {
    if (this.state.frozen) return;
    this.state.frozen = true;
    this.state.reason = reason;
  }
}
