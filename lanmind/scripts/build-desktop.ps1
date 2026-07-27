$ErrorActionPreference = 'Stop'

$cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
if (Test-Path $cargoBin) {
  $env:PATH = "$cargoBin;$env:PATH"
}

# Tauri statically links the Windows runtime. Keep bundled C dependencies,
# including SQLite, on the same runtime to avoid mixed-CRT linker errors.
$env:CFLAGS_x86_64_pc_windows_msvc = '/MT'

# rust-lld is bundled with the Rust toolchain and avoids the old VS linker
# shipped on some Windows developer images. A normal MSVC linker still works
# when rust-lld is unavailable.
$rustcPath = (& rustup which rustc 2>$null)
if ($rustcPath) {
  $toolchainRoot = Split-Path (Split-Path $rustcPath -Parent) -Parent
  $lldPath = Join-Path $toolchainRoot 'lib\rustlib\x86_64-pc-windows-msvc\bin\rust-lld.exe'
  if (Test-Path $lldPath) {
    $env:CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER = $lldPath
  }
}

npx tauri build @args
exit $LASTEXITCODE
