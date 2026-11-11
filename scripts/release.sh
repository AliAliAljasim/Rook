#!/usr/bin/env bash
# Build the Windows installer and publish it as a GitHub release, which the
# app's updater picks up. Bump "version" in package.json and push main first.
# Optional: NOTES="what changed".
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(node -p "require('./package.json').version")
git fetch -q origin
if [ -n "$(git status --porcelain --untracked-files=no)" ] || [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  echo "Commit and push main before releasing, so the release tag matches the code." >&2
  exit 1
fi
if gh release view "v$version" >/dev/null 2>&1; then
  echo "v$version is already released; bump the version in package.json." >&2
  exit 1
fi

rm -rf dist
WINEDEBUG=-all npx electron-builder --win --x64 --publish never
gh release create "v$version" \
  "dist/rook-setup-$version.exe" "dist/rook-setup-$version.exe.blockmap" dist/latest.yml \
  --target main --title "Rook $version" --notes "${NOTES:-Rook $version}"
