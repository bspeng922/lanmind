param([string]$PluginPackageDirectory = '')

$ErrorActionPreference = 'Stop'

$appDir = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $appDir 'src-tauri\tauri.conf.json'
$config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
$productName = $config.productName
$version = $config.version
$releaseDir = Join-Path $appDir 'src-tauri\target\release'
$bundleDir = Join-Path $releaseDir 'bundle'
$installerPrefix = "${productName}_${version}_x64"
$nsisInstaller = "$installerPrefix-setup.exe"

$files = [ordered]@{}
$files[$nsisInstaller] = Join-Path $bundleDir "nsis\$nsisInstaller"
foreach ($language in $config.bundle.windows.wix.language) {
    $installer = "${installerPrefix}_$language.msi"
    $files[$installer] = Join-Path $bundleDir "msi\$installer"
}
$files['lanmind.exe'] = Join-Path $releaseDir 'lanmind.exe'

if ($PluginPackageDirectory) {
    if (-not (Test-Path -LiteralPath $PluginPackageDirectory -PathType Container)) {
        throw "Plugin package directory not found: $PluginPackageDirectory"
    }

    $pluginPackages = Get-ChildItem -LiteralPath $PluginPackageDirectory -File |
        Where-Object { $_.Extension -in '.lmpk', '.zip' } |
        Sort-Object Name
    foreach ($pluginPackage in $pluginPackages) {
        $files["plugins/$($pluginPackage.Name)"] = $pluginPackage.FullName
    }
}

foreach ($source in $files.Values) {
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Missing deployment artifact: $source"
    }
}

$now = Get-Date
$timestamp = $now.ToString('yyyyMMdd-HHmmss')
$deploymentRoot = Join-Path $bundleDir 'deployment'
$deployDir = Join-Path $deploymentRoot "${productName}_${version}_windows_x64_$timestamp"
New-Item -ItemType Directory -Path $deploymentRoot -Force | Out-Null
New-Item -ItemType Directory -Path $deployDir | Out-Null

$buildFiles = [ordered]@{}
$hashLines = foreach ($name in $files.Keys) {
    $fullPath = Join-Path $deployDir $name
    $destinationDir = Split-Path -Parent $fullPath
    if (-not (Test-Path -LiteralPath $destinationDir -PathType Container)) {
        New-Item -ItemType Directory -Path $destinationDir | Out-Null
    }

    Copy-Item -LiteralPath $files[$name] -Destination $fullPath
    $hash = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $buildFiles[$name] = @{
        size = (Get-Item -LiteralPath $fullPath).Length
        sha256 = $hash
    }
    "$hash  $name"
}
[System.IO.File]::WriteAllLines((Join-Path $deployDir 'SHA256SUMS.txt'), [string[]]$hashLines)

$buildMeta = [ordered]@{
    version = $version
    buildTime = $now.ToString('yyyy-MM-dd HH:mm:ss')
    platform = 'windows-x64'
    files = $buildFiles
}
[System.IO.File]::WriteAllText((Join-Path $deployDir 'build.json'), ($buildMeta | ConvertTo-Json -Depth 4))

$readmeContent = @"
$productName（智域协同）$version Windows x64 部署包

运行 $nsisInstaller，按向导完成安装。集中部署时请选择所需语言的 MSI 安装包。
解压后也可直接运行 lanmind.exe。

如果部署包内含 plugins 目录，请在应用内打开“系统设置 → 功能与插件 → 导入插件包”，选择相应的 .lmpk 或 .zip 文件。

SHA256SUMS.txt 记录安装文件和插件包的 SHA-256 哈希。请将 PowerShell 命令的输出与清单对照。
Get-FileHash -LiteralPath .\$nsisInstaller -Algorithm SHA256

build.json 记录版本、文件大小和哈希。
"@
$readmeContent | Out-File -FilePath (Join-Path $deployDir 'README.txt') -Encoding utf8

$zipPath = "$deployDir.zip"
$zipSources = @(Get-ChildItem -LiteralPath $deployDir | Select-Object -ExpandProperty FullName)
Write-Output "Compressing deployment package to $zipPath ..."
Compress-Archive -LiteralPath $zipSources -DestinationPath $zipPath

Write-Output "DEPLOY_DIR=$deployDir"
Write-Output "DEPLOY_ZIP=$zipPath"
Get-ChildItem -LiteralPath $deployDir | Select-Object Name, Length
Get-Item -LiteralPath $zipPath | Select-Object Name, Length
