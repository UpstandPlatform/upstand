const MAX_GLOB_PATTERN_LENGTH = 512;
const MAX_GLOB_INPUT_LENGTH = 4096;

type GlobToken =
  | { kind: "literal"; value: string }
  | { kind: "segment-star" }
  | { kind: "any-star" };

function tokenize(pattern: string): GlobToken[] | null {
  const normalized = pattern.trim();
  if (!normalized || normalized.length > MAX_GLOB_PATTERN_LENGTH) {
    return null;
  }

  const tokens: GlobToken[] = [];
  for (let index = 0; index < normalized.length; index += 1) {
    if (normalized[index] !== "*") {
      tokens.push({ kind: "literal", value: normalized[index] ?? "" });
      continue;
    }

    let end = index + 1;
    while (end < normalized.length && normalized[end] === "*") end += 1;
    tokens.push({ kind: end - index > 1 ? "any-star" : "segment-star" });
    index = end - 1;
  }
  return tokens;
}

function epsilonClosure(tokens: GlobToken[], states: Set<number>): Set<number> {
  const closed = new Set(states);
  const pending = [...states];
  while (pending.length > 0) {
    const state = pending.pop();
    if (state === undefined || state >= tokens.length) continue;
    if (closed.has(state + 1)) continue;
    if (
      tokens[state]?.kind !== "segment-star" &&
      tokens[state]?.kind !== "any-star"
    ) {
      continue;
    }
    closed.add(state + 1);
    pending.push(state + 1);
  }
  return closed;
}

/**
 * Matches the repository's watch-path/tag glob syntax without compiling
 * attacker-controlled text into a JavaScript RegExp. The NFA simulation is
 * bounded by the input limits above, so repeated wildcards cannot trigger
 * exponential backtracking.
 */
export function matchesSafeGlob(
  pattern: string,
  value: string,
  options: { starMatchesSlash?: boolean } = {},
): boolean {
  if (value.length > MAX_GLOB_INPUT_LENGTH) return false;
  const tokens = tokenize(pattern);
  if (!tokens) return false;

  let states = epsilonClosure(tokens, new Set([0]));
  for (const character of value) {
    const next = new Set<number>();
    for (const state of states) {
      const token = tokens[state];
      if (!token) continue;
      if (token.kind === "any-star") {
        next.add(state);
      } else if (token.kind === "segment-star") {
        if (options.starMatchesSlash || character !== "/") next.add(state);
      } else if (token.value === character) {
        next.add(state + 1);
      }
    }
    states = epsilonClosure(tokens, next);
    if (states.size === 0) return false;
  }

  return epsilonClosure(tokens, states).has(tokens.length);
}
