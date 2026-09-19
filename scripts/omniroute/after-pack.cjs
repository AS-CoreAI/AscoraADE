const { spawn } = require('node:child_process')
const { join } = require('node:path')

module.exports = async (context) => {
  const platform = context.electronPlatformName
  if (!['win32', 'linux'].includes(platform)) return
  const targetExecutable = platform === 'win32'
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`)
    : join(context.appOutDir, context.packager.executableName)
  // Cross-built resources are still checked with the host's Electron; native
  // builds additionally verify the executable that will be shipped.
  const executable = platform === process.platform ? targetExecutable : require('electron')
  const root = context.packager.projectDir
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(root, 'scripts/omniroute/smoke.mjs'),
      '--resources', join(context.appOutDir, 'resources'), '--electron', executable],
    { cwd: root, windowsHide: true, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Packaged OmniRoute smoke failed (${code ?? signal}).`)))
  })
}
