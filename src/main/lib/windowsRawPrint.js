import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const POWERSHELL_TIMEOUT_MS = 20_000;

/**
 * Send raw bytes to a Windows printer via Win32 spooler (datatype RAW).
 * Works for USB thermal printers like Xprinter XP-80.
 *
 * Important: a disconnected USB printer often still accepts WritePrinter into the
 * Windows queue. We refuse offline/error printers up front, abort the job if the
 * device is offline after write, and cancel our job so reconnect cannot auto-print.
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

  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'posly-raw-'));
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
public class PoslyRawPrinter {
  public const uint PRINTER_STATUS_PAUSED = 0x00000001;
  public const uint PRINTER_STATUS_ERROR = 0x00000002;
  public const uint PRINTER_STATUS_PAPER_JAM = 0x00000008;
  public const uint PRINTER_STATUS_PAPER_OUT = 0x00000040;
  public const uint PRINTER_STATUS_OFFLINE = 0x00000080;
  public const uint PRINTER_STATUS_OUTPUT_BIN_FULL = 0x00000800;
  public const uint PRINTER_STATUS_NOT_AVAILABLE = 0x00001000;
  public const uint PRINTER_STATUS_NO_TONER = 0x00040000;
  public const uint PRINTER_STATUS_USER_INTERVENTION = 0x00100000;
  public const uint PRINTER_STATUS_DOOR_OPEN = 0x00400000;
  public const uint PRINTER_ATTRIBUTE_WORK_OFFLINE = 0x00000400;
  public const uint JOB_STATUS_ERROR = 0x00000002;
  public const uint JOB_STATUS_OFFLINE = 0x00000020;
  public const uint JOB_STATUS_PAPEROUT = 0x00000040;
  public const uint JOB_STATUS_DELETED = 0x00000100;
  public const uint JOB_STATUS_BLOCKED_DEVQ = 0x00000200;
  public const uint JOB_STATUS_USER_INTERVENTION = 0x00000400;
  public const int JOB_CONTROL_CANCEL = 3;

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public struct PRINTER_INFO_2 {
    public string pServerName;
    public string pPrinterName;
    public string pShareName;
    public string pPortName;
    public string pDriverName;
    public string pComment;
    public string pLocation;
    public IntPtr pDevMode;
    public string pSepFile;
    public string pPrintProcessor;
    public string pDatatype;
    public string pParameters;
    public IntPtr pSecurityDescriptor;
    public uint Attributes;
    public uint Priority;
    public uint DefaultPriority;
    public uint StartTime;
    public uint UntilTime;
    public uint Status;
    public uint cJobs;
    public uint AveragePPM;
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public struct JOB_INFO_1 {
    public uint JobId;
    public string pPrinterName;
    public string pMachineName;
    public string pUserName;
    public string pDocument;
    public string pDatatype;
    public string pStatus;
    public uint Status;
    public uint Priority;
    public uint Position;
    public uint TotalPages;
    public uint PagesPrinted;
    public System.Runtime.InteropServices.ComTypes.FILETIME Submitted;
  }

  [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern int StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
  [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "AbortPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool AbortPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);
  [DllImport("winspool.Drv", EntryPoint = "GetPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool GetPrinter(IntPtr hPrinter, int level, IntPtr pPrinter, int cbBuf, out int pcbNeeded);
  [DllImport("winspool.Drv", EntryPoint = "GetJobA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool GetJob(IntPtr hPrinter, uint JobId, int Level, IntPtr pJob, int cbBuf, out int pcbNeeded);
  [DllImport("winspool.Drv", EntryPoint = "SetJobA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool SetJob(IntPtr hPrinter, uint JobId, int Level, IntPtr pJob, int Command);

  static uint BadPrinterStatusMask =
    PRINTER_STATUS_PAUSED | PRINTER_STATUS_ERROR | PRINTER_STATUS_PAPER_JAM |
    PRINTER_STATUS_PAPER_OUT | PRINTER_STATUS_OFFLINE | PRINTER_STATUS_OUTPUT_BIN_FULL |
    PRINTER_STATUS_NOT_AVAILABLE | PRINTER_STATUS_NO_TONER |
    PRINTER_STATUS_USER_INTERVENTION | PRINTER_STATUS_DOOR_OPEN;

  static uint BadJobStatusMask =
    JOB_STATUS_ERROR | JOB_STATUS_OFFLINE | JOB_STATUS_PAPEROUT |
    JOB_STATUS_DELETED | JOB_STATUS_BLOCKED_DEVQ | JOB_STATUS_USER_INTERVENTION;

  public static void AssertPrinterReady(IntPtr hPrinter) {
    int needed;
    GetPrinter(hPrinter, 2, IntPtr.Zero, 0, out needed);
    if (needed <= 0) {
      throw new Exception("GetPrinter failed to size buffer (Win32 " + Marshal.GetLastWin32Error() + ").");
    }
    IntPtr buffer = Marshal.AllocHGlobal(needed);
    try {
      if (!GetPrinter(hPrinter, 2, buffer, needed, out needed)) {
        throw new Exception("GetPrinter failed (Win32 " + Marshal.GetLastWin32Error() + ").");
      }
      PRINTER_INFO_2 info = (PRINTER_INFO_2)Marshal.PtrToStructure(buffer, typeof(PRINTER_INFO_2));
      if ((info.Attributes & PRINTER_ATTRIBUTE_WORK_OFFLINE) != 0) {
        throw new Exception("Printer is offline (Work Offline). Check USB power/cable and printer power.");
      }
      if ((info.Status & BadPrinterStatusMask) != 0) {
        throw new Exception("Printer not ready (status 0x" + info.Status.ToString("X") + "). Check power, USB, paper, and that the correct printer is selected.");
      }
    } finally {
      Marshal.FreeHGlobal(buffer);
    }
  }

  static void CancelJobIfPossible(IntPtr hPrinter, uint jobId) {
    if (jobId == 0) return;
    try { SetJob(hPrinter, jobId, 0, IntPtr.Zero, JOB_CONTROL_CANCEL); } catch { }
  }

  static void AssertJobOk(IntPtr hPrinter, uint jobId) {
    if (jobId == 0) return;
    int needed;
    GetJob(hPrinter, jobId, 1, IntPtr.Zero, 0, out needed);
    if (needed <= 0) return;
    IntPtr buffer = Marshal.AllocHGlobal(needed);
    try {
      if (!GetJob(hPrinter, jobId, 1, buffer, needed, out needed)) return;
      JOB_INFO_1 job = (JOB_INFO_1)Marshal.PtrToStructure(buffer, typeof(JOB_INFO_1));
      if ((job.Status & BadJobStatusMask) != 0) {
        CancelJobIfPossible(hPrinter, jobId);
        throw new Exception("Print job failed (job status 0x" + job.Status.ToString("X") + "). Check the printer.");
      }
    } finally {
      Marshal.FreeHGlobal(buffer);
    }
  }

  public static void SendBytes(string printerName, byte[] bytes) {
    IntPtr hPrinter;
    if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) {
      throw new Exception("OpenPrinter failed for '" + printerName + "' (Win32 " + Marshal.GetLastWin32Error() + ").");
    }
    bool docStarted = false;
    uint jobId = 0;
    try {
      AssertPrinterReady(hPrinter);

      DOCINFOA di = new DOCINFOA();
      di.pDocName = "POSLY Receipt";
      di.pDataType = "RAW";
      jobId = (uint)StartDocPrinter(hPrinter, 1, di);
      if (jobId == 0) {
        throw new Exception("StartDocPrinter failed (Win32 " + Marshal.GetLastWin32Error() + ").");
      }
      docStarted = true;

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

        // USB unplug often still accepts WritePrinter into the queue. Re-check and
        // abort so reconnect cannot auto-print / kick the drawer.
        System.Threading.Thread.Sleep(400);
        AssertPrinterReady(hPrinter);
        AssertJobOk(hPrinter, jobId);

        if (!EndDocPrinter(hPrinter)) {
          throw new Exception("EndDocPrinter failed (Win32 " + Marshal.GetLastWin32Error() + ").");
        }
        docStarted = false;

        System.Threading.Thread.Sleep(200);
        AssertPrinterReady(hPrinter);
        AssertJobOk(hPrinter, jobId);
      } catch {
        try { AbortPrinter(hPrinter); } catch { }
        CancelJobIfPossible(hPrinter, jobId);
        docStarted = false;
        throw;
      }
    } finally {
      if (docStarted) {
        try { AbortPrinter(hPrinter); } catch { }
        CancelJobIfPossible(hPrinter, jobId);
      }
      ClosePrinter(hPrinter);
    }
  }
}
"@

$printer = ${JSON.stringify(name)}

# CIM / Get-Printer often catch USB-unplugged / Work Offline before Win32 write.
try {
  $gp = Get-Printer -Name $printer -ErrorAction Stop
  $bad = @('Offline','Error','PaperOut','PaperJam','NotAvailable','NoToner','DoorOpen','Paused','UserIntervention')
  if ($bad -contains [string]$gp.PrinterStatus) {
    throw "Printer status is '$($gp.PrinterStatus)'. Check power, USB, paper, and Settings printer selection."
  }
} catch [System.Management.Automation.ItemNotFoundException] {
  throw "Printer '$printer' was not found. Select the correct receipt printer in Settings."
}

try {
  $filterName = $printer.Replace("'", "''")
  $cim = Get-CimInstance -ClassName Win32_Printer -Filter "Name='$filterName'" -ErrorAction SilentlyContinue
  if ($null -ne $cim) {
    if ($cim.WorkOffline) {
      throw "Printer is offline (Work Offline). Check USB power/cable and printer power."
    }
    # Win32_Printer.PrinterStatus: 7 = Offline
    if ([int]$cim.PrinterStatus -eq 7) {
      throw "Printer reports Offline. Check power and USB cable."
    }
  }
} catch {
  if ($_.Exception.Message -match 'offline|Offline|USB|paper|Printer') { throw }
}

$path = ${JSON.stringify(binPath)}
$bytes = [System.IO.File]::ReadAllBytes($path)
Write-Output ("BYTES_LEN=" + $bytes.Length)
[PoslyRawPrinter]::SendBytes($printer, $bytes)
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
