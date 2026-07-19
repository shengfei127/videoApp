import fs from 'node:fs'
import path from 'node:path'

const roots = ['src', 'dist']
const forbidden = [
  /VITE_BAIDU_(SECRET|SIGN)/iu,
  /client_secret\s*[:=]/iu,
  /\b(?:SecretKey|SignKey)\s*[:=]/iu
]
const findings = []
const tokenName = '(?:(?:[A-Za-z_$][\\w$]*)?access_?token)'
const tokenAssignment = new RegExp(
  `\\b${tokenName}\\s*=\\s*(["'\\x60])([A-Za-z0-9._-]{20,})\\1`,
  'giu'
)
const tokenProperty = new RegExp(
  `(?:["'\\x60]${tokenName}["'\\x60]|\\b${tokenName}\\b)\\s*:\\s*(["'\\x60])([A-Za-z0-9._-]{20,})\\1`,
  'giu'
)
const tokenQuery = /(?:^|[?&#"'`])access_token\s*=\s*([A-Za-z0-9._-]{20,})/giu

for (const root of roots) {
  walk(root)
}

if (findings.length > 0) {
  console.error('Forbidden credential patterns found:')
  console.error(findings.join('\n'))
  process.exit(1)
}

console.log('No forbidden credential patterns found.')

function walk(target) {
  if (!fs.existsSync(target)) {
    return
  }

  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const full = path.join(target, entry.name)
    if (entry.isDirectory()) {
      walk(full)
      continue
    }

    if (!entry.isFile()) {
      continue
    }

    let text
    try {
      text = fs.readFileSync(full, 'utf8')
    } catch {
      findings.push(`Could not scan candidate file: ${toPortablePath(full)}`)
      continue
    }

    for (const pattern of forbidden) {
      pattern.lastIndex = 0
      if (pattern.test(text)) {
        findings.push(`${toPortablePath(full)}: ${pattern}`)
      }
    }

    collectTokenFinding(full, text, tokenAssignment)
    collectTokenFinding(full, text, tokenProperty)
    collectTokenFinding(full, text, tokenQuery)
  }
}

function collectTokenFinding(target, text, pattern) {
  pattern.lastIndex = 0
  let match
  while ((match = pattern.exec(text)) !== null) {
    const value = match[2] ?? match[1]
    if (!isPlaceholderToken(value)) {
      findings.push(`${toPortablePath(target)}: hardcoded access token`)
      return
    }
  }
}

function isPlaceholderToken(value) {
  return /(?:^|[-_.])(?:mock|sentinel|placeholder)(?:[-_.]|$)/iu.test(value)
}

function toPortablePath(value) {
  return value.split(path.sep).join('/')
}
