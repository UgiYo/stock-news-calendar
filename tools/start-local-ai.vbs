Option Explicit
Dim shell, files, folder, command
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
folder = files.GetParentFolderName(WScript.ScriptFullName)
If Not files.FileExists(folder & "\local_ai_bridge.py") Then
  MsgBox "Extract the ZIP first. local_ai_bridge.py must be in the same folder.", 48, "Local AI"
  WScript.Quit 1
End If
command = " -3 " & Chr(34) & folder & "\local_ai_bridge.py" & Chr(34) & " --background --open"
On Error Resume Next
shell.Run "pyw" & command, 0, False
If Err.Number <> 0 Then
  Err.Clear
  shell.Run "pythonw " & Chr(34) & folder & "\local_ai_bridge.py" & Chr(34) & " --background --open", 0, False
  If Err.Number <> 0 Then
    MsgBox "Python 3.8+ is required. If company policy blocks VBS, use start-local-ai.bat instead.", 48, "Local AI"
  End If
End If
