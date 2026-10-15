$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$office = $null; $target = $null; $owned = $false
$workDir = Join-Path ([IO.Path]::GetTempPath()) ('md-king-quick-paste-' + [Guid]::NewGuid())
try {
  $office = New-Object -ComObject Word.Application
  if ($office.Documents.Count -ne 0) { throw 'Test requires an isolated Office instance' }
  $owned = $true
  $office.Visible = $true
  $office.DisplayAlerts = 0
  [void][IO.Directory]::CreateDirectory($workDir)
  $path = Join-Path $workDir "中文'文件.docx"
  Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::Open($path, [IO.Compression.ZipArchiveMode]::Create)
  try {
    $parts = @{
      '[Content_Types].xml' = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      '_rels/.rels' = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
      'word/document.xml' = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>快捷粘贴测试</w:t></w:r></w:p><w:p><w:r><w:t>中文正文</w:t></w:r></w:p></w:body></w:document>'
    }
    foreach ($name in $parts.Keys) {
      $writer = New-Object IO.StreamWriter($zip.CreateEntry($name).Open(), (New-Object Text.UTF8Encoding($false)))
      try { $writer.Write($parts[$name]) } finally { $writer.Dispose() }
    }
  } finally { $zip.Dispose() }
  $target = $office.Documents.Add()
  $office.Visible = $true
  $target.Content.Text = '前文后文'
  $target.Range(2, 2).Select()
  $script = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__INSERT_SCRIPT_BASE64__'))
  $script = $script.Replace('__MD_KING_TARGET_WINDOW__', [string]$target.ActiveWindow.Hwnd)
  $script = $script.Replace('__MD_KING_DOCX_PATH__', $path.Replace("'", "''"))
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
  & powershell.exe -NoProfile -NonInteractive -STA -EncodedCommand $encoded
  if ($LASTEXITCODE -ne 0) { throw 'Insertion failed' }
  $text = $target.Content.Text
  if ($text -notmatch '前文快捷粘贴测试' -or $text -notmatch '中文正文' -or $text -notmatch '后文') {
    throw "Wrong insertion position or text: $text"
  }
  if ($target.Range(2, 8).Font.Bold -ne -1) { throw 'Bold formatting lost' }
  $badScript = $script.Replace($path.Replace("'", "''"), ($path + '.missing').Replace("'", "''"))
  $badEncoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($badScript))
  $info = New-Object Diagnostics.ProcessStartInfo
  $info.FileName = 'powershell.exe'
  $info.Arguments = "-NoProfile -NonInteractive -STA -EncodedCommand $badEncoded"
  $info.UseShellExecute = $false; $info.CreateNoWindow = $true
  $info.RedirectStandardError = $true; $info.RedirectStandardOutput = $true
  $info.StandardErrorEncoding = New-Object Text.UTF8Encoding($false)
  $process = [Diagnostics.Process]::Start($info)
  $detail = $process.StandardError.ReadToEnd(); $process.WaitForExit()
  if ($process.ExitCode -eq 0 -or $detail -notmatch '插入 Word/WPS 失败：' -or $detail -match '没有找到正在运行') {
    throw "Insertion failure was hidden or garbled: $detail"
  }
  Write-Output 'PASS: target window, cursor, Chinese text, formatting, original insertion errors'
} finally {
  if ($target -ne $null) { $target.Close(0) }
  if ($owned -and $office -ne $null) { $office.Quit() }
  if (Test-Path -LiteralPath $workDir) {
    [IO.File]::Delete((Join-Path $workDir "中文'文件.docx"))
    [IO.Directory]::Delete($workDir)
  }
}
