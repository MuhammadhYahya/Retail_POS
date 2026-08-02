import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const POWERSHELL_TIMEOUT_MS = 20_000;

/**
 * Send raw bytes to a Windows printer via Win32 spooler (datatype RAW).
 * Works for USB thermal printers like Xprinter XP-80.
 */
export async function writeRawToWindowsPrinter(printerName, data) {
  const name = String(printerName || '').trim();
  if (!name) {
    throw new Error('Printer name is required.');
  }
  if (!Buffer.isBuffer(data) || !data.length) {
    throw new Error('Print data is empty.');
  }
  if (process.platform !== 'win32') {
    throw new Error('Windows raw printing is only available on Windows.');
  }

  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'zen-raw-'));
  const binPath = path.join(tmpDir, 'receipt.bin');
  const psPath = path.join(tmpDir, 'rawprint.ps1');

  try {
    await fs.promises.writeFile(binPath, data);

    const script = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Runtime.InteropServices;
public class ZenRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }
  [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern int StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
  [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

  public static void SendBytes(string printerName, byte[] bytes) {
    IntPtr hPrinter;
    if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) {
      throw new Exception("OpenPrinter failed for '" + printerName + "' (Win32 " + Marshal.GetLastWin32Error() + ").");
    }
    try {
      DOCINFOA di = new DOCINFOA();
      di.pDocName = "ZEN Receipt";
      di.pDataType = "RAW";
      if (StartDocPrinter(hPrinter, 1, di) == 0) {
        throw new Exception("StartDocPrinter failed (Win32 " + Marshal.GetLastWin32Error() + ").");
      }
      try {
        if (!StartPagePrinter(hPrinter)) {
          throw new Exception("StartPagePrinter failed (Win32 " + Marshal.GetLastWin32Error() + ").");
        }
        try {
          IntPtr pUnmanaged = Marshal.AllocCoTaskMem(bytes.Length);
          try {
            Marshal.Copy(bytes, 0, pUnmanaged, bytes.Length);
            int written;
            if (!WritePrinter(hPrinter, pUnmanaged, bytes.Length, out written)) {
              throw new Exception("WritePrinter failed (Win32 " + Marshal.GetLastWin32Error() + ").");
            }
            if (written != bytes.Length) {
              throw new Exception("WritePrinter partial write: " + written + " of " + bytes.Length);
            }
            Console.WriteLine("WRITTEN=" + written);
          } finally {
            Marshal.FreeCoTaskMem(pUnmanaged);
          }
        } finally {
          EndPagePrinter(hPrinter);
        }
      } finally {
        EndDocPrinter(hPrinter);
      }
    } finally {
      ClosePrinter(hPrinter);
    }
  }
}
"@
$printer = ${JSON.stringify(name)}
$path = ${JSON.stringify(binPath)}
$bytes = [System.IO.File]::ReadAllBytes($path)
Write-Output ("BYTES_LEN=" + $bytes.Length)
[ZenRawPrinter]::SendBytes($printer, $bytes)
Write-Output "OK"
`;

    await fs.promises.writeFile(psPath, script, 'utf8');

    const output = await runPowerShell(psPath);
    if (!String(output).includes('OK')) {
      throw new Error(output || 'Raw print did not confirm success.');
    }
    return {
      written: Number(String(output).match(/WRITTEN=(\d+)/)?.[1] || 0),
      bytesLen: Number(String(output).match(/BYTES_LEN=(\d+)/)?.[1] || data.length),
    };
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

function runPowerShell(scriptPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { windowsHide: true }
    );
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
        // ignore
      }
      reject(new Error(`Printer timed out after ${POWERSHELL_TIMEOUT_MS / 1000}s. Check the XP-80U is online and not paused.`));
    }, POWERSHELL_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || stdout.trim() || `PowerShell exited with code ${code}`));
    });
  });
}
