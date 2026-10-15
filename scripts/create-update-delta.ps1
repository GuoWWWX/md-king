param(
  [Parameter(Mandatory = $true)][string]$SourceInstaller,
  [Parameter(Mandatory = $true)][string]$BaseVersion,
  [string]$TargetInstaller,
  [string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
$projectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$base = $BaseVersion.TrimStart('v')
if ($version -notmatch '^\d+\.\d+\.\d+$' -or $base -notmatch '^\d+\.\d+\.\d+$' -or [version]$base -ge [version]$version) {
  throw 'Delta base must be an older stable X.Y.Z version'
}
if (!$OutputDirectory) { $OutputDirectory = Join-Path $projectRoot 'src-tauri/target/release/bundle/nsis' }
if (!$TargetInstaller) { $TargetInstaller = Join-Path $OutputDirectory "md-king_${version}_x64-setup.exe" }
$metadataPath = Join-Path $OutputDirectory 'update-delta.json'
if (Test-Path -LiteralPath $metadataPath) { Remove-Item -LiteralPath $metadataPath }

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class MdKingDelta {
  [StructLayout(LayoutKind.Sequential)] struct Input { public IntPtr Start; public UIntPtr Size; public int Editable; }
  [StructLayout(LayoutKind.Sequential)] struct Output { public IntPtr Start; public UIntPtr Size; }
  [DllImport("msdelta.dll", SetLastError=true)] static extern bool CreateDeltaB(long type, long flags, long reset, Input source, Input target, Input sourceOptions, Input targetOptions, Input globalOptions, IntPtr time, uint hash, out Output delta);
  [DllImport("msdelta.dll", SetLastError=true)] static extern bool ApplyDeltaProvidedB(long flags, Input source, Input delta, IntPtr target, UIntPtr size);
  [DllImport("msdelta.dll")] static extern bool DeltaFree(IntPtr memory);
  static Input Pin(byte[] bytes, out GCHandle pin) { pin=GCHandle.Alloc(bytes,GCHandleType.Pinned); return new Input { Start=pin.AddrOfPinnedObject(), Size=(UIntPtr)bytes.Length }; }
  public static byte[] Create(byte[] source, byte[] target) {
    GCHandle oldPin,newPin;
    var oldData=Pin(source,out oldPin); var newData=Pin(target,out newPin);
    try {
      Output delta;
      // RAW files; permit installers larger than MSDelta's default 32 MiB limit.
      if(!CreateDeltaB(1,0x20000,0,oldData,newData,new Input(),new Input(),new Input(),IntPtr.Zero,0,out delta)) throw new System.ComponentModel.Win32Exception();
      try { var bytes=new byte[checked((int)delta.Size)]; Marshal.Copy(delta.Start,bytes,0,bytes.Length); return bytes; }
      finally { DeltaFree(delta.Start); }
    } finally { oldPin.Free(); newPin.Free(); }
  }
  public static byte[] Apply(byte[] source, byte[] patch, int size) {
    GCHandle oldPin,patchPin,newPin;
    var oldData=Pin(source,out oldPin); var patchData=Pin(patch,out patchPin); var bytes=new byte[size]; var newData=Pin(bytes,out newPin);
    try { if(!ApplyDeltaProvidedB(0,oldData,patchData,newData.Start,newData.Size)) throw new System.ComponentModel.Win32Exception(); return bytes; }
    finally { oldPin.Free(); patchPin.Free(); newPin.Free(); }
  }
}
'@

$source = [IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $SourceInstaller))
$target = [IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $TargetInstaller))
$patch = [MdKingDelta]::Create($source, $target)
if ($patch.Length -ge $target.Length * 0.9) {
  Write-Host 'Delta saves less than 10%; this release will use the full installer.'
  return
}
$hash = { param([byte[]]$bytes) [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant() }
$restored = [MdKingDelta]::Apply($source, $patch, $target.Length)
$targetHash = & $hash $target
if ((& $hash $restored) -cne $targetHash) { throw 'Delta roundtrip did not reproduce the complete installer' }
$asset = "md-king_${base}_to_${version}_x64.patch"
[IO.File]::WriteAllBytes((Join-Path $OutputDirectory $asset), $patch)
$metadata = [ordered]@{ base_version="v$base"; base_size=$source.Length; base_sha256=(& $hash $source); asset=$asset; size=$patch.Length; sha256=(& $hash $patch) }
$metadata | ConvertTo-Json -Compress | Set-Content -LiteralPath $metadataPath -Encoding utf8
Write-Host "Delta: $($patch.Length) / $($target.Length) bytes; restored installer SHA-256 verified."
