#!/usr/bin/env bash
# Agent pre-completion self-check for Employee Face AI's frontend.
#
# Greps for the mechanically-checkable AGENTS.md rules that ESLint doesn't
# already enforce: no inline styles (rule 28), no `any` (rules 19/20), no
# imperative DOM query/interaction (rule 29), no stray Promise construction
# outside the two sanctioned exceptions (rule 30).
#
# Run this before declaring any frontend template/component change done:
#   ./scripts/check-agent-rules.sh
#
# Exits non-zero if a hard-failing check (inline style / any / imperative DOM)
# finds a match. The Promise check is informational only — it lists Promise
# call sites for a human/agent to confirm against rule 30, since most matches
# are the sanctioned DialogService/webcam patterns, not violations.

set -uo pipefail
cd "$(dirname "$0")/.."

FRONT="frontend/src/app"
fail=0

echo "== 1) Inline styles in templates (rule 28) =="
hits=$(grep -rn 'style="' "$FRONT" --include="*.html")
if [ -n "$hits" ]; then
  echo "$hits"
  echo "❌ Found raw style=\"...\" attributes above."
  echo "   Extract into a class in the component's own .scss, or into a shared"
  echo "   partial (_hud-form.scss / _employee-profile.scss) if reused."
  fail=1
else
  echo "✅ none"
fi

echo
echo "== 2) 'any' type usage (rules 19/20) =="
hits=$(grep -rnE '(:\s*any\b|<any>|\bas any\b|Array<any>|any\[\])' "$FRONT" --include="*.ts" | grep -v '\.spec\.ts:')
if [ -n "$hits" ]; then
  echo "$hits"
  echo "❌ Found 'any' usage above."
  echo "   Use a real model type, ApiResponse<T>, HttpErrorResponse, or 'unknown' + narrowing."
  fail=1
else
  echo "✅ none"
fi

echo
echo "== 3) Imperative DOM query / addEventListener (rule 29) =="
# date-picker.ts's own DatePickerComponent is the sanctioned exception:
#   - elementRef.nativeElement.querySelector('.date-trigger') reads layout
#     geometry (getBoundingClientRect), not an interaction.
#   - it already uses RxJS fromEvent for window scroll/resize, not addEventListener.
hits=$(grep -rnE 'document\.(getElementById|querySelector)\(|\.addEventListener\(' "$FRONT" --include="*.ts" \
  | grep -v 'core/components/date-picker/date-picker.ts')
if [ -n "$hits" ]; then
  echo "$hits"
  echo "❌ Found direct DOM query / addEventListener above."
  echo "   Use viewChild<ElementRef<...>>('ref') + .nativeElement.click() for triggering"
  echo "   hidden controls, or RxJS fromEvent (+ Subscription cleanup) for global listeners."
  fail=1
else
  echo "✅ none outside date-picker.ts's sanctioned fromEvent-based panel positioning"
fi

echo
echo "== 4) Promise construction (rule 30 — informational, confirm manually) =="
allowed_pattern='core/services/webcam-capture\.service\.ts|core/services/dialog\.service\.ts'
hits=$(grep -rlE 'new Promise\(' "$FRONT" --include="*.ts" | grep -vE "$allowed_pattern")
if [ -n "$hits" ]; then
  echo "$hits"
  echo "⚠️  Files above construct a 'new Promise(...)' directly. Confirm each site wraps"
  echo "   an unavoidable browser API (see webcam-capture.service.ts) rather than"
  echo "   reimplementing something HttpClient/RxJS already does."
else
  echo "✅ none outside webcam-capture.service.ts / dialog.service.ts"
fi

echo
if [ "$fail" -eq 1 ]; then
  echo "❌ One or more required checks failed — fix before declaring the task done."
  exit 1
fi

echo "✅ All automated checks passed."
echo "   Still needs manual judgment (not grep-able): no duplicated code (rule 22),"
echo "   correct dumb-vs-self-contained component split (Frontend Application section),"
echo "   design-token-only CSS values (rule 21), zero-warning lint/tsc (rule 24)."
