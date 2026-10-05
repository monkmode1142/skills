#!/usr/bin/env node
// Typecheck every ```ts block in the effect skill against a pinned effect install.
//
// Each ```ts block becomes its own module and must be self-contained (imports included).
// Mark a block that is intentionally partial or wrong (an anti-pattern, a v3 example)
// with ```ts nocheck — it is skipped. Errors map back to <file.md>:<line>.
//
// Usage: node plugins/effect/scripts/check-effect-examples.mjs [skill-dir | file.md ...]
// The pinned toolchain lives in scripts/effect-examples/ (run `npm install` there once).
import { execFileSync } from "node:child_process"
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, "..")
const targets = process.argv.length > 2 ? process.argv.slice(2).map((p) => resolve(p)) : [join(root, "skills/effect")]
const project = join(here, "effect-examples")
// One blocks dir + tsconfig per run, so concurrent runs never see each other's files.
const out = join(project, `blocks-${process.pid}`)

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : path.endsWith(".md") ? [path] : []
  })

mkdirSync(out, { recursive: true })
writeFileSync(join(out, "tsconfig.json"), JSON.stringify({ extends: "../tsconfig.json", include: ["./*.ts"] }))

const origin = new Map()
let count = 0
let skipped = 0
for (const file of targets.flatMap((t) => (statSync(t).isDirectory() ? walk(t) : [t]))) {
  const lines = readFileSync(file, "utf8").split("\n")
  for (let i = 0; i < lines.length; i++) {
    const open = /^```(ts|typescript)\b(.*)$/.exec(lines[i].trim())
    if (!open) continue
    const start = i + 1
    let end = start
    while (end < lines.length && lines[end].trim() !== "```") end++
    if (/\bnocheck\b/.test(open[2])) {
      skipped++
    } else {
      const name = `block${String(count++).padStart(3, "0")}.ts`
      // `export {}` forces module scope so blocks never collide.
      writeFileSync(join(out, name), lines.slice(start, end).join("\n") + "\nexport {}\n")
      origin.set(name, { file: relative(root, file), line: start + 1 })
    }
    i = end
  }
}

let output = ""
try {
  execFileSync(join(project, "node_modules/.bin/tsc"), ["-p", out, "--pretty", "false"], { cwd: project, encoding: "utf8" })
} catch (error) {
  output = String(error.stdout ?? "") + String(error.stderr ?? "")
}
rmSync(out, { recursive: true, force: true })

const errors = output
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const m = /(block\d+\.ts)\((\d+),(\d+)\): (.*)$/.exec(line)
    if (!m) return line
    const o = origin.get(m[1])
    return `${o.file}:${o.line + Number(m[2]) - 1}:${m[3]} ${m[4]}`
  })

console.log(`checked ${count} block(s), skipped ${skipped} nocheck block(s)`)
if (errors.length > 0) {
  console.log(errors.join("\n"))
  process.exit(1)
}
console.log("all examples typecheck")
