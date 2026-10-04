export const BRIEF_FIELDS = [
  "GOAL",
  "SCOPE",
  "CONTEXT",
  "PREMISES",
  "ACCEPTANCE",
  "VERIFY",
  "TIMEBOX",
  "FORBIDDEN",
  "REPORT",
  "STANDING",
] as const;

export const EFFECT_DELEGATE_LINES = [
  "Load the **effect** skill and run its §1 version gate before writing code. Follow the installed version where it differs.",
  "Before reporting done, run the effect skill's §8 checklist and include its result.",
] as const;

const EFFECT_MENTION = /\bEffect\b|\beffect skill\b|@effect\/|\beffect@/;

function fieldBodies(text: string): ReadonlyMap<string, string> {
  const bodies = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of text.replace(/\r/g, "").split("\n")) {
    const match = /^([A-Z]+)\b[ \t:]*(.*)$/.exec(line);
    const name = match?.[1];
    if (name !== undefined && (BRIEF_FIELDS as readonly string[]).includes(name)) {
      current = [match?.[2] ?? ""];
      bodies.set(name, current);
    } else if (current !== null) {
      current.push(line);
    }
  }
  return new Map(
    [...bodies].map(([name, lines]) => [name, lines.join("\n").trim()])
  );
}

export function briefProblems(
  text: string,
  standing: readonly string[]
): readonly string[] {
  const bodies = fieldBodies(text);
  const problems: string[] = [];
  for (const field of BRIEF_FIELDS) {
    const body = bodies.get(field);
    if (body === undefined) {
      problems.push(`missing ${field}`);
    } else if (body.length === 0 && field !== "STANDING") {
      problems.push(`empty ${field}`);
    }
  }
  const standingBody = bodies.get("STANDING") ?? "";
  const missingOrders = standing.filter((line) => !standingBody.includes(line));
  if (missingOrders.length > 0) {
    problems.push(
      `STANDING lacks ${missingOrders.length} of ${standing.length} current standing orders; paste preferences.md verbatim (orch standing show)`
    );
  }
  if (EFFECT_MENTION.test(text)) {
    for (const line of EFFECT_DELEGATE_LINES) {
      if (!text.includes(line)) {
        problems.push(
          `Effect brief lacks the delegate line from references/effect.md: "${line}"`
        );
      }
    }
  }
  return problems;
}
