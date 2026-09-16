import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const gitOutput = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard'],
  { cwd: root, encoding: 'utf8' },
);
const markdownFiles = gitOutput
  .split(/\r?\n/)
  .filter(file => file.toLowerCase().endsWith('.md'))
  .sort((left, right) => left.localeCompare(right));

const failures = [];
const anchorCache = new Map();

function addFailure(source, line, target, reason) {
  failures.push(`${source}:${line}: ${target} (${reason})`);
}

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function exactPath(relativePath) {
  const normalized = path.normalize(relativePath);
  const outside = normalized === '..' || normalized.startsWith(`..${path.sep}`) || path.isAbsolute(normalized);
  if (outside) return { error: 'target leaves the repository' };

  let current = root;
  for (const segment of normalized.split(path.sep).filter(Boolean)) {
    let entries;
    try {
      entries = readdirSync(current);
    } catch {
      return { error: 'target does not exist' };
    }
    if (!entries.includes(segment)) {
      const caseMatch = entries.find(entry => entry.toLowerCase() === segment.toLowerCase());
      return { error: caseMatch ? `path casing differs; found ${caseMatch}` : 'target does not exist' };
    }
    current = path.join(current, segment);
  }

  try {
    statSync(current);
  } catch {
    return { error: 'target does not exist' };
  }
  return { absolute: current };
}

function slugHeading(heading) {
  return heading
    .replace(/<[^>]*>/g, '')
    .replace(/[`*_~]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

function anchorsFor(file) {
  if (anchorCache.has(file)) return anchorCache.get(file);
  const anchors = new Set();
  const counts = new Map();
  let fence = null;

  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      fence = fence === marker ? null : (fence ?? marker);
      continue;
    }
    if (fence) continue;

    const headingMatch = line.match(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!headingMatch) continue;
    const base = slugHeading(headingMatch[1]);
    if (!base) continue;
    const count = counts.get(base) ?? 0;
    anchors.add(count === 0 ? base : `${base}-${count}`);
    counts.set(base, count + 1);
  }

  anchorCache.set(file, anchors);
  return anchors;
}

function validateTarget(source, lineNumber, rawTarget) {
  const target = rawTarget.trim().replace(/^<|>$/g, '');
  if (!target || target.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(target)) return;

  const hashIndex = target.indexOf('#');
  const rawPath = hashIndex === -1 ? target : target.slice(0, hashIndex);
  const rawFragment = hashIndex === -1 ? '' : target.slice(hashIndex + 1);
  const queryIndex = rawPath.indexOf('?');
  const encodedPath = queryIndex === -1 ? rawPath : rawPath.slice(0, queryIndex);
  const decodedPath = decode(encodedPath);
  const fragment = decode(rawFragment);
  if (decodedPath === null || fragment === null) {
    addFailure(source, lineNumber, rawTarget, 'invalid URL encoding');
    return;
  }

  const sourceAbsolute = path.join(root, ...source.split('/'));
  let targetAbsolute = sourceAbsolute;
  if (decodedPath) {
    const relative = path.relative(root, path.resolve(path.dirname(sourceAbsolute), decodedPath));
    const result = exactPath(relative);
    if (result.error) {
      addFailure(source, lineNumber, rawTarget, result.error);
      return;
    }
    targetAbsolute = result.absolute;
  }

  if (fragment && path.extname(targetAbsolute).toLowerCase() === '.md') {
    const normalizedFragment = fragment.toLowerCase().replace(/^user-content-/, '');
    if (!anchorsFor(targetAbsolute).has(normalizedFragment)) {
      addFailure(source, lineNumber, rawTarget, `heading #${fragment} does not exist`);
    }
  }
}

for (const source of markdownFiles) {
  const absolute = path.join(root, ...source.split('/'));
  const lines = readFileSync(absolute, 'utf8').split(/\r?\n/);
  let fence = null;

  lines.forEach((line, index) => {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      fence = fence === marker ? null : (fence ?? marker);
      return;
    }
    if (fence) return;

    const inlineLinks = line.matchAll(/!?\[[^\]]*\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g);
    for (const match of inlineLinks) validateTarget(source, index + 1, match[1]);

    const reference = line.match(/^\s*\[[^\]]+\]:\s*(<[^>]+>|\S+)/);
    if (reference) validateTarget(source, index + 1, reference[1]);
  });
}

if (failures.length) {
  console.error(`Documentation link check failed with ${failures.length} error${failures.length === 1 ? '' : 's'}:`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Documentation links OK (${markdownFiles.length} Markdown files).`);
}
