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

export const FIELD_NAME = /^[A-Z][A-Z0-9]*( [A-Z0-9]+)*$/;

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

// A registered field may sit indented inside another field (a block in CONTEXT),
// so it is found anywhere and runs to the next blank line or top-level field.
export function extraFieldBody(text: string, field: string): string | null {
  const lines = text.replace(/\r/g, "").split("\n");
  const head = new RegExp(`^\\s*${field.replace(/ /g, "\\s+")}\\b[ \\t:]*(.*)$`);
  const start = lines.findIndex((line) => head.test(line));
  if (start < 0) {
    return null;
  }
  const body = [head.exec(lines[start] ?? "")?.[1] ?? ""];
  for (const line of lines.slice(start + 1)) {
    if (line.trim().length === 0 || /^[A-Z]{2,}\b/.test(line)) {
      break;
    }
    body.push(line);
  }
  return body.join("\n").trim();
}

export function briefProblems(
  text: string,
  standing: readonly string[],
  extraFields: readonly string[] = []
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
  for (const field of extraFields) {
    const body = extraFieldBody(text, field);
    if (body === null) {
      problems.push(`missing ${field} (required by orch brief require)`);
    } else if (body.length === 0) {
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
  return problems;
}
