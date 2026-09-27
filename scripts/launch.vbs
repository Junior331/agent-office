' Abre o Escritorio de Agentes: sobe o servidor (escondido) se nao estiver rodando e abre o navegador.
' Uso: wscript launch.vbs            -> sobe e abre o navegador
'      wscript launch.vbs silent     -> so sobe (usado pela atualizacao)
Option Explicit
Dim sh, fso, app, i, silent
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
app = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
silent = (WScript.Arguments.Count > 0)

If Not IsUp() Then
  sh.CurrentDirectory = app
  sh.Run "cmd /c node """ & app & "\server.js"" >> """ & app & "\office.log"" 2>&1", 0, False
  For i = 1 To 30
    WScript.Sleep 300
    If IsUp() Then Exit For
  Next
End If

If Not silent Then sh.Run "http://localhost:4000"

Function IsUp()
  Dim x
  On Error Resume Next
  Set x = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  x.setTimeouts 500, 500, 500, 500
  x.Open "GET", "http://127.0.0.1:4000/health", False
  x.Send
  IsUp = (Err.Number = 0)
  If IsUp Then IsUp = (x.Status = 200)
  On Error GoTo 0
End Function
