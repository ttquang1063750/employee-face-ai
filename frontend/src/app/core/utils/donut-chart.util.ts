export interface DonutSegment {
  key: string;
  label: string;
  value: number;
  color: string;
  offset: number;
}

export interface DonutSegmentInput {
  key: string;
  label: string;
  color: string;
  value: number;
}

// Stacks pre-computed percentage values (0-100, expected to sum to ~100)
// into cumulative stroke-dashoffsets so <app-mood-donut> can render them as
// consecutive arcs around a circle whose circumference is normalized to 100
// units (see mood-donut.html's <circle stroke-dasharray>). Shared by every
// donut-chart consumer (dashboard's org-wide mood chart, attendance-summary's
// per-employee mood/check-in-out charts) so the offset-stacking logic — the
// actual repeated pattern — only lives in one place.
export function buildDonutSegments(inputs: DonutSegmentInput[]): DonutSegment[] {
  let acc = 0;
  return inputs.map((input) => {
    const offset = -acc;
    acc += input.value;
    return { ...input, offset };
  });
}
