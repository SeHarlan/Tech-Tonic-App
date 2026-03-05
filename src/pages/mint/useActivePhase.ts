import { useState, useEffect, useMemo } from 'react';
import {
  CLUSTER,
  DEMO_MODE,
  MINT_START_TIME,
  MINT_PHASES,
  type MintPhase,
} from '../../config/env';

export interface PhaseState {
  phase: MintPhase;
  status: 'past' | 'active' | 'future' | 'disabled';
  startMs: number;
  endMs: number | null;
}

export function computePhases(now: number): PhaseState[] {
  const start = new Date(MINT_START_TIME).getTime();
  let cursor = start;

  return MINT_PHASES.map((phase) => {
    const phaseStart = cursor;
    const phaseEnd = phase.durationMs ? cursor + phase.durationMs : null;

    if (DEMO_MODE) {
      if (phase.disabledOnDevnet) {
        return { phase, status: 'past', startMs: phaseStart, endMs: phaseEnd };
      }
      return { phase, status: 'active', startMs: phaseStart, endMs: phaseEnd };
    }

    const isDevnet = CLUSTER === 'devnet';
    const disabled = isDevnet && phase.disabledOnDevnet;

    if (!disabled && phase.durationMs) {
      cursor += phase.durationMs;
    }

    if (disabled) {
      return { phase, status: 'disabled', startMs: phaseStart, endMs: phaseEnd };
    }
    if (phaseEnd !== null && now >= phaseEnd) {
      return { phase, status: 'past', startMs: phaseStart, endMs: phaseEnd };
    }
    if (now >= phaseStart) {
      return { phase, status: 'active', startMs: phaseStart, endMs: phaseEnd };
    }
    return { phase, status: 'future', startMs: phaseStart, endMs: phaseEnd };
  });
}

export type ActivePhaseGroup = string | null;

/** Returns the currently active mint phase group ('skr' | 'public' | null). */
export function useActivePhase(): ActivePhaseGroup {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  return useMemo(() => {
    const phases = computePhases(now);
    const active = phases.find((p) => p.status === 'active');
    return active?.phase.group ?? null;
  }, [now]);
}
