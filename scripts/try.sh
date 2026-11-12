#!/usr/bin/env bash
# Build the current working tree (committed or not) as a throwaway test copy and start it on Windows.
# It goes to %TEMP%\rook-try-<version>-<time>, marked by a ROOK_TRY file (src/main.js reads it), and is started
# by a hidden PowerShell watcher that deletes the folder once the copy has quit. Nothing is published,
# installed or registered with Windows.
# It copies your settings (vault, CLI path, name) from the installed Rook, so it works on your real vault.
# FRESH=1 starts it with no settings, which shows the first-run setup.
set -euo pipefail
cd "$(dirname "$0")/.."

win_env() { cmd.exe /d /c "echo %$1%" 2>/dev/null | tr -d '\r'; }
temp=$(wslpath "$(win_env TEMP)")
appdata=$(wslpath "$(win_env APPDATA)")

# Leftovers from a test copy whose watcher did not finish (PC shut down, watcher killed). One still running is skipped.
for old in "$temp"/rook-try-*; do [ -d "$old" ] && rm -rf "$old" 2>/dev/null || true; done

rm -rf dist/win-unpacked
WINEDEBUG=-all npx electron-builder --win --x64 --dir --publish never

version=$(node -p "require('./package.json').version")
dest="$temp/rook-try-$version-$(date +%H%M%S)"
cp -r dist/win-unpacked "$dest"
touch "$dest/ROOK_TRY"
mkdir -p "$dest/profile"
if [ "${FRESH:-}" != 1 ] && [ -f "$appdata/Rook/config.json" ]; then
  cp "$appdata/Rook/config.json" "$dest/profile/config.json"
fi

# The watcher: start the copy, wait until none of its processes are left, then delete the folder
# (retrying for a minute while Windows still holds files). It only ever deletes a rook-try-* folder in TEMP.
windest=$(wslpath -w "$dest")
ps=$(cat <<EOF
\$dir = '$windest'
\$log = Join-Path \$env:TEMP 'rook-try.log'
function Note(\$t) { "\$(Get-Date -Format HH:mm:ss) \$t" | Out-File -FilePath \$log -Append -Encoding utf8 }
if ((Split-Path \$dir -Leaf) -notlike 'rook-try-*' -or (Split-Path \$dir -Parent) -ne (Get-Item \$env:TEMP).FullName.TrimEnd('\\')) { Note "refused: \$dir"; exit 1 }
\$p = Start-Process -FilePath (Join-Path \$dir 'rook.exe') -WorkingDirectory \$env:TEMP -PassThru
Note "started \$dir (pid \$(\$p.Id))"
\$p.WaitForExit()
Note "main process exited (code \$(\$p.ExitCode))"
for (\$i = 0; \$i -lt 30; \$i++) {
  Start-Sleep -Seconds 2
  if (Get-Process rook -ErrorAction SilentlyContinue | Where-Object { \$_.Path -like "\$dir\\*" }) { continue }
  Remove-Item -LiteralPath \$dir -Recurse -Force -ErrorAction SilentlyContinue
  if (-not (Test-Path -LiteralPath \$dir)) { Note "deleted"; break }
}
if (Test-Path -LiteralPath \$dir) { Note "could not delete; the next make try will" }
EOF
)
encoded=$(printf '%s' "$ps" | iconv -t UTF-16LE | base64 -w0)
# Start-Process launches the watcher without handing it this terminal, so this script returns straight away.
(cd "$temp" && powershell.exe -NoProfile -Command "Start-Process powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile','-EncodedCommand','$encoded'")
echo "Started the test copy from $windest. Quit it and the folder is deleted (log: %TEMP%\\rook-try.log)."
