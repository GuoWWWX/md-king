$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  $path = '__MD_KING_DOCX_PATH__'
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw '待插入的临时文档已不存在，请重新复制 Markdown 后再试。'
  }
  $targetWindow = [IntPtr]::new(__MD_KING_TARGET_WINDOW__)
  Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class MdKingOfficeWindow {
  public delegate bool Callback(IntPtr window, IntPtr parameter);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr window);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr window, Callback callback, IntPtr parameter);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder name, int count);
  [DllImport("oleacc.dll")] private static extern int AccessibleObjectFromWindow(IntPtr window, uint objectId, ref Guid iid, [MarshalAs(UnmanagedType.IDispatch)] out object result);
  public static object GetDocumentWindow(IntPtr window) {
    object result = null;
    Callback callback = (child, parameter) => {
      var name = new StringBuilder(256);
      GetClassName(child, name, name.Capacity);
      if (name.ToString() != "_WwG" || !IsWindowVisible(child)) return true;
      var iid = new Guid("00020400-0000-0000-C000-000000000046");
      return AccessibleObjectFromWindow(child, 0xFFFFFFF0, ref iid, out result) != 0 || result == null;
    };
    EnumChildWindows(window, callback, IntPtr.Zero);
    GC.KeepAlive(callback);
    return result;
  }
}
"@
  $officeNames = @('WINWORD', 'wps')
  if ($targetWindow -ne [IntPtr]::Zero -and -not [MdKingOfficeWindow]::IsWindow($targetWindow)) {
    throw '原来的目标窗口已关闭，请在 Word/WPS 文档中重新按快捷键。'
  }
  [uint32]$targetProcessId = 0
  [void][MdKingOfficeWindow]::GetWindowThreadProcessId($targetWindow, [ref]$targetProcessId)
  $targetProcess = Get-Process -Id $targetProcessId -ErrorAction SilentlyContinue
  if ($null -eq $targetProcess -or $targetProcess.ProcessName -notin $officeNames) {
    $windows = @(Get-Process -Name $officeNames -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
    if ($windows.Count -ne 1) {
      throw '请先打开 Word/WPS 文档，把光标放到插入位置后，在文档中按快捷键。'
    }
    $targetWindow = $windows[0].MainWindowHandle
  }
  if (-not [MdKingOfficeWindow]::IsWindow($targetWindow)) {
    throw '原来的 Word/WPS 窗口已关闭，请在目标文档中重新按快捷键。'
  }
  $documentWindow = [MdKingOfficeWindow]::GetDocumentWindow($targetWindow)
  if ($null -eq $documentWindow) {
    throw '无法连接目标 Word/WPS 文档，请关闭弹窗并确认软件与 md-king 使用相同的管理员权限后重试。'
  }
  $selection = $documentWindow.Selection
  if ($null -eq $selection) { throw '未找到当前光标位置，请先进入文档编辑区域。' }
  $selection.InsertFile($path)
  exit 0
} catch {
  [Console]::Error.WriteLine('插入 Word/WPS 失败：' + $_.Exception.Message)
  exit 1
}
