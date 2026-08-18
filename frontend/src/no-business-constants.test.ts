import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Spec section 43: no business value may be hard-coded in the frontend.
 *
 * Tolerances, adjustment percentages, suppression thresholds, calibrator and
 * control identities all come from `/api/rule-definitions` and the analytics
 * configuration. This test is the enforcement — a reviewer will not reliably spot
 * a `25` that crept into a component, but this will.
 *
 * It scans feature code only. Test files legitimately contain fixtures, and the
 * type layer describes the wire contract rather than choosing values.
 */

const FEATURE_ROOT = join(import.meta.dirname, "features");

/** The numbers that would be business values if they appeared in feature code. */
const SUSPICIOUS_NUMBERS = [
  { value: "25", meaning: "calibration/control tolerance (D-03/D-04)" },
  { value: "90", meaning: "ISTD suppression threshold (D-05)" },
  { value: "1.5", meaning: "WCS1 cut-off concentration (D-10)" },
];

const SUSPICIOUS_IDENTIFIERS = [
  { pattern: /["'`]Cal_\d+["'`]/, meaning: "calibrator identity (D-08)" },
  { pattern: /["'`]WCS\d+["'`]/, meaning: "control identity (D-10)" },
  { pattern: /["'`]Mitragynine["'`]/i, meaning: "a specific analyte name" },
];

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      found.push(path);
    }
  }
  return found;
}

/** A string that is a Tailwind class list rather than a value. */
const TAILWIND_TOKEN =
  /(?:^|\s)(?:px|py|pt|pb|pl|pr|mx|my|mt|mb|ml|mr|[wh]|max-w|min-w|gap|text|bg|border|rounded|ring|flex|grid|space|divide|opacity|shadow|top|left|right|bottom|inset|z|col|row|leading|tracking)-/;

/**
 * Strip comments, imports and class-name strings.
 *
 * `py-1.5` is spacing, not a cut-off concentration. Leaving Tailwind in the scan
 * would produce noise that trains people to ignore this test, which is worse than
 * not having it.
 */
function code(contents: string): string {
  return contents
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/"[^"\n]*"|`[^`]*`/g, (literal) =>
      TAILWIND_TOKEN.test(literal) ? '""' : literal,
    )
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
    .filter((line) => !line.trim().startsWith("import "))
    .join("\n");
}

describe("the frontend ships no business configuration", () => {
  const files = sourceFiles(FEATURE_ROOT);

  it("finds feature source to scan", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(SUSPICIOUS_NUMBERS)(
    "does not hard-code $value — $meaning",
    ({ value }) => {
      const offenders = files.filter((file) => {
        const source = code(readFileSync(file, "utf8"));
        // Match the number as a standalone literal, not as part of a larger one
        // (a `100` in a percentage width, or a `250ms` duration, is not a threshold).
        return new RegExp(`(?<![\\w.])${value.replace(".", "\\.")}(?![\\w.%])`).test(source);
      });
      expect(offenders).toEqual([]);
    },
  );

  it.each(SUSPICIOUS_IDENTIFIERS)(
    "does not hard-code $meaning",
    ({ pattern }) => {
      const offenders = files.filter((file) => pattern.test(code(readFileSync(file, "utf8"))));
      expect(offenders).toEqual([]);
    },
  );

  it("reads rule parameters from the catalogue rather than naming them", () => {
    // A component that switches on `rule_key === "ion_ratio"` to decide which
    // fields to show has re-implemented the catalogue in TypeScript.
    const offenders = files.filter((file) => {
      const source = code(readFileSync(file, "utf8"));
      return /rule_key\s*===\s*["'`]/.test(source);
    });
    expect(offenders).toEqual([]);
  });
});
