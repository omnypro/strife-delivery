// Bumps the version everywhere it lives, commits, and tags.
//
//   bun run bump patch        0.1.0 -> 0.1.1
//   bun run bump minor        0.1.0 -> 0.2.0
//   bun run bump major        0.1.0 -> 1.0.0
//   bun run bump 0.3.0        exactly that
//
// tauri.conf.json reads its version from package.json, so package.json is the
// source of truth; Cargo.toml and Cargo.lock just follow along.

import { $ } from 'bun';

const fail = (msg: string): never => {
  console.error(msg);
  process.exit(1);
};

const arg = process.argv[2];
if (!arg) fail('Usage: bun run bump patch|minor|major|<x.y.z>');

if ((await $`git status --porcelain`.text()).trim()) {
  fail('Commit or stash your changes first; the bump should be its own commit.');
}

const pkgPath = 'package.json';
const pkgText = await Bun.file(pkgPath).text();
const current = JSON.parse(pkgText).version as string;
const parts = current.split('.').map(Number);
if (parts.length !== 3 || parts.some(Number.isNaN)) fail(`Can't read the version in package.json: ${current}`);
const [major, minor, patch] = parts;

const next = {
  major: `${major + 1}.0.0`,
  minor: `${major}.${minor + 1}.0`,
  patch: `${major}.${minor}.${patch + 1}`,
}[arg] ?? arg;
if (!/^\d+\.\d+\.\d+$/.test(next)) fail(`Not a version: ${next}`);
if (next === current) fail(`Already at ${current}.`);

const tag = `v${next}`;
if ((await $`git tag --list ${tag}`.text()).trim()) fail(`Tag ${tag} already exists.`);

function replaceOnce(text: string, pattern: RegExp, replacement: string, file: string): string {
  if (!pattern.test(text)) fail(`Couldn't find the version in ${file}.`);
  return text.replace(pattern, replacement);
}

await Bun.write(
  pkgPath,
  replaceOnce(pkgText, /"version": "[^"]+"/, `"version": "${next}"`, pkgPath),
);

const cargoPath = 'src-tauri/Cargo.toml';
await Bun.write(
  cargoPath,
  replaceOnce(await Bun.file(cargoPath).text(), /^version = "[^"]+"/m, `version = "${next}"`, cargoPath),
);

const lockPath = 'src-tauri/Cargo.lock';
await Bun.write(
  lockPath,
  replaceOnce(
    await Bun.file(lockPath).text(),
    /(name = "strife-delivery"\nversion = )"[^"]+"/,
    `$1"${next}"`,
    lockPath,
  ),
);

const msg = `${process.env.TMPDIR ?? '/tmp'}/strife-bump-msg`;
await Bun.write(msg, `Bump to ${next}.\n`);
await $`git add ${pkgPath} ${cargoPath} ${lockPath}`;
await $`git commit -F ${msg}`;
await $`rm -f ${msg}`;
await $`git tag ${tag}`;

console.log(`\n${current} -> ${next}, committed and tagged ${tag}.`);
console.log(`Push when you're ready:  git push; and git push origin ${tag}`);
