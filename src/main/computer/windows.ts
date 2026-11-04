import { execFile } from 'node:child_process'
import { join } from 'node:path'
import type { ComputerAction } from '@shared/computer'

// Static program, JSON on stdin: model text is never interpolated into shell code.
// Send each gesture in a single SendInput batch, including all key/button releases.
export const WINDOWS_INPUT_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class AscoraInput {
  [StructLayout(LayoutKind.Sequential)] struct MOUSE { public int dx,dy; public uint mouseData,flags,time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct KEY { public ushort vk,scan; public uint flags,time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] struct DATA { [FieldOffset(0)] public MOUSE mouse; [FieldOffset(0)] public KEY key; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public DATA data; }
  [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint count, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
  public static void Focus(long handle) {
    IntPtr window=new IntPtr(handle);
    if(!IsWindow(window)) throw new Exception("The observed window was closed. Take a new screenshot.");
    if(GetForegroundWindow()!=window) {
      SetForegroundWindow(window); System.Threading.Thread.Sleep(150);
      if(GetForegroundWindow()!=window) throw new Exception("Cannot focus the observed window. Focus it manually and take a new screenshot.");
    }
  }
  static List<INPUT> events = new List<INPUT>();
  static void Mouse(uint flags, int x, int y, int data) {
    INPUT input = new INPUT(); input.type = 0;
    input.data.mouse = new MOUSE { dx=x, dy=y, flags=flags, mouseData=unchecked((uint)data) };
    events.Add(input);
  }
  static void Move(int x, int y) {
    int left=GetSystemMetrics(76), top=GetSystemMetrics(77), width=GetSystemMetrics(78), height=GetSystemMetrics(79);
    if (x<left || y<top || x>=left+width || y>=top+height) throw new Exception("Pointer is outside the desktop.");
    Mouse(0xC001 | 0x2000, (int)Math.Round((x-left)*65535.0/Math.Max(1,width-1)), (int)Math.Round((y-top)*65535.0/Math.Max(1,height-1)), 0);
  }
  static void Key(ushort vk, ushort scan, uint flags) {
    INPUT input=new INPUT(); input.type=1; input.data.key=new KEY { vk=vk, scan=scan, flags=flags }; events.Add(input);
  }
  static ushort Code(string key) {
    string[] names={"CTRL","ALT","SHIFT","WIN","ENTER","TAB","ESC","SPACE","BACKSPACE","DELETE","INSERT","HOME","END","PAGEUP","PAGEDOWN","UP","DOWN","LEFT","RIGHT"};
    ushort[] codes={0x11,0x12,0x10,0x5B,0x0D,0x09,0x1B,0x20,0x08,0x2E,0x2D,0x24,0x23,0x21,0x22,0x26,0x28,0x25,0x27};
    int index=Array.IndexOf(names,key); if(index>=0) return codes[index];
    if(key.Length==1 && ((key[0]>='A' && key[0]<='Z') || (key[0]>='0' && key[0]<='9'))) return key[0];
    int f; if(key.StartsWith("F") && int.TryParse(key.Substring(1),out f) && f>=1 && f<=12) return (ushort)(0x6F+f);
    throw new Exception("Unsupported key.");
  }
  static uint Extended(ushort code) { return (code>=0x21 && code<=0x2E) || code==0x5B ? 1u : 0u; }
  public static void Run(string action,int x,int y,int tx,int ty,string button,string direction,int amount,string text,string key) {
    events.Clear(); SetThreadDpiAwarenessContext(new IntPtr(-4));
    if(action=="probe") return;
    if(action=="click" || action=="double_click" || action=="move" || action=="drag" || action=="scroll") Move(x,y);
    if(action=="click" || action=="double_click") {
      uint down=button=="right"?8u:button=="middle"?32u:2u;
      for(int i=0;i<(action=="double_click"?2:1);i++){ Mouse(down,0,0,0); Mouse(down*2,0,0,0); }
    } else if(action=="drag") {
      Mouse(2,0,0,0);
      for(int i=1;i<=20;i++) Move(x+(tx-x)*i/20,y+(ty-y)*i/20);
      Mouse(4,0,0,0);
    } else if(action=="scroll") {
      Mouse(direction=="left" || direction=="right"?0x1000u:0x800u,0,0,amount*120*(direction=="down" || direction=="left"?-1:1));
    } else if(action=="type") {
      foreach(char c in text) {
        if(c=='\r') continue;
        if(c=='\n' || c=='\t') { ushort code=c=='\n'?(ushort)13:(ushort)9; Key(code,0,0); Key(code,0,2); }
        else { Key(0,c,4); Key(0,c,6); }
      }
    } else if(action=="key") {
      string[] keys=key.Split('+');
      foreach(string k in keys){ ushort c=Code(k); Key(c,0,Extended(c)); }
      Array.Reverse(keys);
      foreach(string k in keys){ ushort c=Code(k); Key(c,0,Extended(c)|2); }
    }
    if(events.Count==0) throw new Exception("No input events.");
    INPUT[] inputs=events.ToArray();
    if(SendInput((uint)inputs.Length,inputs,Marshal.SizeOf(typeof(INPUT))) != inputs.Length)
      throw new Exception("Windows blocked input. The target may be elevated or on a protected desktop.");
  }
}
'@
$a = [Console]::In.ReadToEnd() | ConvertFrom-Json
if ($a.foregroundWindow) { [AscoraInput]::Focus([long]$a.foregroundWindow) }
[AscoraInput]::Run($a.action, [int]$a.x, [int]$a.y, [int]$a.to_x, [int]$a.to_y, $a.button, $a.direction, [int]$a.amount, $a.text, $a.key)
[Console]::WriteLine((@{ok=$true; foregroundWindow=[AscoraInput]::GetForegroundWindow().ToInt64().ToString()} | ConvertTo-Json -Compress))
`

export function runWindowsInput(action: ComputerAction | { action: 'probe' }, signal: AbortSignal, foregroundWindow?: string): Promise<string> {
  if (signal.aborted) return Promise.reject(new Error('Computer use stopped.'))
  return new Promise((resolve, reject) => {
    const executable = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const child = execFile(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(WINDOWS_INPUT_SCRIPT, 'utf16le').toString('base64')],
      { windowsHide: true, signal, timeout: 15_000, maxBuffer: 256 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error) reject(new Error(signal.aborted ? 'Computer use stopped.' : stderr.trim().slice(0, 600) || error.message))
        else {
          try {
            const result = JSON.parse(stdout.trim()) as { ok: boolean; foregroundWindow: string }
            if (!result.ok || !/^\d+$/.test(result.foregroundWindow)) throw new Error('Windows input helper returned no result.')
            resolve(result.foregroundWindow)
          } catch (error) { reject(error) }
        }
      })
    child.stdin?.on('error', () => { /* process completion reports the failure */ })
    child.stdin?.end(JSON.stringify({ ...action, foregroundWindow }), 'utf8')
  })
}
