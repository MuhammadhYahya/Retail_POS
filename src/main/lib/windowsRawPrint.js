import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ingestWin32LogLines, pipelineLog } from './printPipelineLog.js';

const POWERSHELL_TIMEOUT_MS = 20_000;

/**
 * Send raw bytes to a Windows printer via Win32 spooler (datatype RAW).
 * Investigation build: emits WIN32LOG|* lines for every native API call.
 * Control-flow / success rules are unchanged from the recovery pass.
 */
export async function writeRawToWindowsPrinter(printerName, data) {
  const name = String(printerName || '').trim();
  pipelineLog('windowsRawPrint.enter', {
    printerName: name,
    bytes: Buffer.isBuffer(data) ? data.length : 0,
    platform: process.platform,
  });

  if (!name) {
    pipelineLog('windowsRawPrint.exit', { success: false, error: 'Printer name is required.' });
    throw new Error('Printer name is required.');
  }
  if (!Buffer.isBuffer(data) || !data.length) {
    pipelineLog('windowsRawPrint.exit', { success: false, error: 'Print data is empty.' });
    throw new Error('Print data is empty.');
  }
  if (process.platform !== 'win32') {
    pipelineLog('windowsRawPrint.exit', {
      success: false,
      error: 'Windows raw printing is only available on Windows.',
    });
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

  static void Log(string api, string jsonFields) {
    Console.WriteLine("WIN32LOG|{\\"api\\":\\"" + api + "\\"," + jsonFields + "}");
  }

  static string DecodePrinterState(uint status, uint attributes) {
    bool offline = (status & PRINTER_STATUS_OFFLINE) != 0 || (attributes & PRINTER_ATTRIBUTE_WORK_OFFLINE) != 0;
    bool error = (status & PRINTER_STATUS_ERROR) != 0;
    bool paperOut = (status & PRINTER_STATUS_PAPER_OUT) != 0;
    if (offline) return "Offline";
    if (error) return "Error";
    if (paperOut) return "PaperOut";
    if ((status & BadPrinterStatusMask) != 0) return "NotReady";
    return "Ready";
  }

  public static void AssertPrinterReady(IntPtr hPrinter, string phase) {
    int needed = 0;
    bool sizeOk = GetPrinter(hPrinter, 2, IntPtr.Zero, 0, out needed);
    int sizeErr = Marshal.GetLastWin32Error();
    Log("GetPrinter", "\\"phase\\":\\"" + phase + "-size\\",\\"ok\\":" + (sizeOk ? "true" : "false") + ",\\"needed\\":" + needed + ",\\"lastError\\":" + sizeErr);
    if (needed <= 0) {
      throw new Exception("GetPrinter failed to size buffer (Win32 " + sizeErr + ").");
    }
    IntPtr buffer = Marshal.AllocHGlobal(needed);
    try {
      bool ok = GetPrinter(hPrinter, 2, buffer, needed, out needed);
      int lastError = Marshal.GetLastWin32Error();
      if (!ok) {
        Log("GetPrinter", "\\"phase\\":\\"" + phase + "\\",\\"ok\\":false,\\"lastError\\":" + lastError);
        throw new Exception("GetPrinter failed (Win32 " + lastError + ").");
      }
      PRINTER_INFO_2 info = (PRINTER_INFO_2)Marshal.PtrToStructure(buffer, typeof(PRINTER_INFO_2));
      string state = DecodePrinterState(info.Status, info.Attributes);
      Log("GetPrinter", "\\"phase\\":\\"" + phase + "\\",\\"ok\\":true,\\"lastError\\":" + lastError + ",\\"status\\":" + info.Status + ",\\"attributes\\":" + info.Attributes + ",\\"cJobs\\":" + info.cJobs + ",\\"port\\":\\"" + (info.pPortName ?? "") + "\\",\\"workOffline\\":" + (((info.Attributes & PRINTER_ATTRIBUTE_WORK_OFFLINE) != 0) ? "true" : "false") + ",\\"printerState\\":\\"" + state + "\\"");
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
    bool ok = SetJob(hPrinter, jobId, 0, IntPtr.Zero, JOB_CONTROL_CANCEL);
    int lastError = Marshal.GetLastWin32Error();
    Log("SetJob", "\\"command\\":\\"CANCEL\\",\\"jobId\\":" + jobId + ",\\"ok\\":" + (ok ? "true" : "false") + ",\\"lastError\\":" + lastError);
  }

  static void AssertJobOk(IntPtr hPrinter, uint jobId, string phase) {
    if (jobId == 0) return;
    int needed = 0;
    GetJob(hPrinter, jobId, 1, IntPtr.Zero, 0, out needed);
    int sizeErr = Marshal.GetLastWin32Error();
    Log("GetJob", "\\"phase\\":\\"" + phase + "-size\\",\\"jobId\\":" + jobId + ",\\"needed\\":" + needed + ",\\"lastError\\":" + sizeErr);
    if (needed <= 0) return;
    IntPtr buffer = Marshal.AllocHGlobal(needed);
    try {
      bool ok = GetJob(hPrinter, jobId, 1, buffer, needed, out needed);
      int lastError = Marshal.GetLastWin32Error();
      if (!ok) {
        Log("GetJob", "\\"phase\\":\\"" + phase + "\\",\\"jobId\\":" + jobId + ",\\"ok\\":false,\\"lastError\\":" + lastError);
        return;
      }
      JOB_INFO_1 job = (JOB_INFO_1)Marshal.PtrToStructure(buffer, typeof(JOB_INFO_1));
      Log("GetJob", "\\"phase\\":\\"" + phase + "\\",\\"jobId\\":" + jobId + ",\\"ok\\":true,\\"lastError\\":" + lastError + ",\\"jobStatus\\":" + job.Status + ",\\"pStatus\\":\\"" + (job.pStatus ?? "") + "\\",\\"inSpooler\\":true");
      if ((job.Status & BadJobStatusMask) != 0) {
        CancelJobIfPossible(hPrinter, jobId);
        throw new Exception("Print job failed (job status 0x" + job.Status.ToString("X") + "). Check the printer.");
      }
    } finally {
      Marshal.FreeHGlobal(buffer);
    }
  }

  public static void SendBytes(string printerName, byte[] bytes) {
    Log("SendBytes", "\\"event\\":\\"enter\\",\\"printerName\\":\\"" + printerName.Replace("\\\\", "\\\\\\\\").Replace("\\"", "") + "\\",\\"bytes\\":" + bytes.Length);
    IntPtr hPrinter;
    bool opened = OpenPrinter(printerName, out hPrinter, IntPtr.Zero);
    int openErr = Marshal.GetLastWin32Error();
    Log("OpenPrinter", "\\"ok\\":" + (opened ? "true" : "false") + ",\\"lastError\\":" + openErr + ",\\"printerName\\":\\"" + printerName.Replace("\\\\", "\\\\\\\\").Replace("\\"", "") + "\\"");
    if (!opened) {
      throw new Exception("OpenPrinter failed for '" + printerName + "' (Win32 " + openErr + ").");
    }
    bool docStarted = false;
    uint jobId = 0;
    try {
      AssertPrinterReady(hPrinter, "before-StartDoc");

      DOCINFOA di = new DOCINFOA();
      di.pDocName = "POSLY Receipt";
      di.pDataType = "RAW";
      int startDocResult = StartDocPrinter(hPrinter, 1, di);
      int startDocErr = Marshal.GetLastWin32Error();
      jobId = (uint)startDocResult;
      Log("StartDocPrinter", "\\"ok\\":" + (startDocResult != 0 ? "true" : "false") + ",\\"jobId\\":" + jobId + ",\\"lastError\\":" + startDocErr + ",\\"jobAddedToSpooler\\":" + (startDocResult != 0 ? "true" : "false"));
      if (jobId == 0) {
        throw new Exception("StartDocPrinter failed (Win32 " + startDocErr + ").");
      }
      docStarted = true;

      try {
        bool startPage = StartPagePrinter(hPrinter);
        int startPageErr = Marshal.GetLastWin32Error();
        Log("StartPagePrinter", "\\"ok\\":" + (startPage ? "true" : "false") + ",\\"lastError\\":" + startPageErr);
        if (!startPage) {
          throw new Exception("StartPagePrinter failed (Win32 " + startPageErr + ").");
        }
        try {
          IntPtr pUnmanaged = Marshal.AllocCoTaskMem(bytes.Length);
          try {
            Marshal.Copy(bytes, 0, pUnmanaged, bytes.Length);
            int written;
            bool writeOk = WritePrinter(hPrinter, pUnmanaged, bytes.Length, out written);
            int writeErr = Marshal.GetLastWin32Error();
            Log("WritePrinter", "\\"ok\\":" + (writeOk ? "true" : "false") + ",\\"bytesRequested\\":" + bytes.Length + ",\\"bytesWritten\\":" + written + ",\\"lastError\\":" + writeErr);
            if (!writeOk) {
              throw new Exception("WritePrinter failed (Win32 " + writeErr + ").");
            }
            if (written != bytes.Length) {
              throw new Exception("WritePrinter partial write: " + written + " of " + bytes.Length);
            }
            Console.WriteLine("WRITTEN=" + written);
          } finally {
            Marshal.FreeCoTaskMem(pUnmanaged);
          }
        } finally {
          bool endPage = EndPagePrinter(hPrinter);
          int endPageErr = Marshal.GetLastWin32Error();
          Log("EndPagePrinter", "\\"ok\\":" + (endPage ? "true" : "false") + ",\\"lastError\\":" + endPageErr);
        }

        System.Threading.Thread.Sleep(400);
        AssertPrinterReady(hPrinter, "after-WritePrinter");
        AssertJobOk(hPrinter, jobId, "after-WritePrinter");

        bool endDoc = EndDocPrinter(hPrinter);
        int endDocErr = Marshal.GetLastWin32Error();
        Log("EndDocPrinter", "\\"ok\\":" + (endDoc ? "true" : "false") + ",\\"lastError\\":" + endDocErr + ",\\"jobCommittedToSpooler\\":" + (endDoc ? "true" : "false"));
        if (!endDoc) {
          throw new Exception("EndDocPrinter failed (Win32 " + endDocErr + ").");
        }
        docStarted = false;

        System.Threading.Thread.Sleep(200);
        AssertPrinterReady(hPrinter, "after-EndDoc");
        AssertJobOk(hPrinter, jobId, "after-EndDoc");
        Log("SendBytes", "\\"event\\":\\"success\\",\\"jobId\\":" + jobId + ",\\"bytes\\":" + bytes.Length);
      } catch (Exception ex) {
        Log("SendBytes", "\\"event\\":\\"catch\\",\\"error\\":\\"" + ex.Message.Replace("\\\\", "\\\\\\\\").Replace("\\"", "'") + "\\",\\"jobId\\":" + jobId);
        try {
          bool aborted = AbortPrinter(hPrinter);
          int abortErr = Marshal.GetLastWin32Error();
          Log("AbortPrinter", "\\"ok\\":" + (aborted ? "true" : "false") + ",\\"lastError\\":" + abortErr);
        } catch { }
        CancelJobIfPossible(hPrinter, jobId);
        docStarted = false;
        throw;
      }
    } finally {
      if (docStarted) {
        try {
          bool aborted = AbortPrinter(hPrinter);
          int abortErr = Marshal.GetLastWin32Error();
          Log("AbortPrinter", "\\"phase\\":\\"finally\\",\\"ok\\":" + (aborted ? "true" : "false") + ",\\"lastError\\":" + abortErr);
        } catch { }
        CancelJobIfPossible(hPrinter, jobId);
      }
      bool closed = ClosePrinter(hPrinter);
      int closeErr = Marshal.GetLastWin32Error();
      Log("ClosePrinter", "\\"ok\\":" + (closed ? "true" : "false") + ",\\"lastError\\":" + closeErr);
    }
  }
}
"@

$printer = ${JSON.stringify(name)}

try {
  $gp = Get-Printer -Name $printer -ErrorAction Stop
  Write-Output ("WIN32LOG|" + (@{
    api = "Get-Printer"
    ok = $true
    printerStatus = [string]$gp.PrinterStatus
    printerName = $gp.Name
    portName = $gp.PortName
  } | ConvertTo-Json -Compress))
  $bad = @('Offline','Error','PaperOut','PaperJam','NotAvailable','NoToner','DoorOpen','Paused','UserIntervention')
  if ($bad -contains [string]$gp.PrinterStatus) {
    throw "Printer status is '$($gp.PrinterStatus)'. Check power, USB, paper, and Settings printer selection."
  }
} catch [System.Management.Automation.ItemNotFoundException] {
  Write-Output ("WIN32LOG|" + (@{ api = "Get-Printer"; ok = $false; error = "not found"; printerName = $printer } | ConvertTo-Json -Compress))
  throw "Printer '$printer' was not found. Select the correct receipt printer in Settings."
}

try {
  $filterName = $printer.Replace("'", "''")
  $cim = Get-CimInstance -ClassName Win32_Printer -Filter "Name='$filterName'" -ErrorAction SilentlyContinue
  if ($null -ne $cim) {
    Write-Output ("WIN32LOG|" + (@{
      api = "Win32_Printer"
      ok = $true
      workOffline = [bool]$cim.WorkOffline
      printerStatus = [int]$cim.PrinterStatus
      detectedErrorState = [int]$cim.DetectedErrorState
      printerState = [int]$cim.PrinterState
    } | ConvertTo-Json -Compress))
    if ($cim.WorkOffline) {
      throw "Printer is offline (Work Offline). Check USB power/cable and printer power."
    }
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
    pipelineLog('windowsRawPrint.powershell.start', { printerName: name, bytes: data.length, psPath });

    const output = await runPowerShell(psPath);
    const win32Count = ingestWin32LogLines(output);
    pipelineLog('windowsRawPrint.powershell.output', {
      printerName: name,
      win32LogCount: win32Count,
      hasOK: String(output).includes('OK'),
      stdoutTail: String(output).slice(-1500),
    });

    if (!String(output).includes('OK')) {
      pipelineLog('windowsRawPrint.exit', { success: false, error: output || 'Raw print did not confirm success.' });
      throw new Error(output || 'Raw print did not confirm success.');
    }
    const result = {
      written: Number(String(output).match(/WRITTEN=(\d+)/)?.[1] || 0),
      bytesLen: Number(String(output).match(/BYTES_LEN=(\d+)/)?.[1] || data.length),
    };
    pipelineLog('windowsRawPrint.exit', { success: true, ...result, printerName: name });
    return result;
  } catch (err) {
    pipelineLog('windowsRawPrint.exit', {
      success: false,
      error: err.message,
      printerName: name,
    });
    throw err;
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
