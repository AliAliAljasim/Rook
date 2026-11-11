"use strict";
// electron-builder afterPack hook: put the app icon and name into the Windows
// exe. electron-builder's own resource editing needs Wine on Linux, so it is
// off (signAndEditExecutable: false) and rcedit runs here instead: natively on
// Windows, or through WSL's Windows interop.
const { execFileSync } = require('child_process');
const path = require('path');

const winPath = (p) => (process.platform === 'win32' ? p : execFileSync('wslpath', ['-w', p]).toString().trim());

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const name = context.packager.platformSpecificBuildOptions.executableName || context.packager.appInfo.productFilename;
  const exe = path.join(context.appOutDir, name + '.exe');
  const icon = path.join(context.packager.projectDir, 'build', 'icon.ico');
  const rcedit = path.join(context.packager.projectDir, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe');
  const { version } = context.packager.appInfo;
  try {
    execFileSync(rcedit, [
      winPath(exe),
      '--set-icon', winPath(icon),
      '--set-version-string', 'FileDescription', 'Rook',
      '--set-version-string', 'ProductName', 'Rook',
      '--set-file-version', version,
      '--set-product-version', version
    ], { stdio: 'inherit' });
  } catch (err) {
    throw new Error('Could not set the exe icon with rcedit (needs Windows or WSL interop): ' + err.message);
  }
};
