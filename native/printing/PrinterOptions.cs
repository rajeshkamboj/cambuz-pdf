using System;
using System.ComponentModel;
using System.Drawing.Printing;
using System.Runtime.InteropServices;
using System.Text;

internal static class PrinterOptions
{
    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
    [DllImport("winspool.drv")] private static extern bool ClosePrinter(IntPtr handle);
    [DllImport("winspool.drv", CharSet = CharSet.Unicode)]
    private static extern int DocumentProperties(IntPtr owner, IntPtr printer, string name, IntPtr output, IntPtr input, int flags);
    [DllImport("winspool.drv", CharSet = CharSet.Unicode)]
    private static extern bool GetPrinter(IntPtr printer, int level, out uint status, int size, out int needed);

    internal static void List()
    {
        string defaultName = new PrinterSettings().PrinterName;
        foreach (string name in PrinterSettings.InstalledPrinters) {
            IntPtr handle;
            string status = "";
            if (OpenPrinter(name, out handle, IntPtr.Zero)) {
                try {
                    uint flags;
                    int needed;
                    if (GetPrinter(handle, 6, out flags, 4, out needed)) {
                        if ((flags & 0x80) != 0) status = "Offline";
                        else if ((flags & 1) != 0) status = "Paused";
                        else if ((flags & 2) != 0) status = "Error";
                        else if ((flags & 0x10) != 0) status = "Out of paper";
                        else if ((flags & 0x400) != 0) status = "Printing";
                    }
                } finally { ClosePrinter(handle); }
            }
            Console.WriteLine(Convert.ToBase64String(Encoding.UTF8.GetBytes(name)) + "|" +
                (String.Equals(name, defaultName, StringComparison.OrdinalIgnoreCase) ? "1" : "0") + "|" + status);
        }
    }

    // The driver owns both public and private DEVMODE bytes. No call writes
    // system-wide defaults. The opaque result lives only in the main process.
    internal static int Preferences(IntPtr owner, string name, string previous)
    {
        IntPtr printer;
        if (!OpenPrinter(name, out printer, IntPtr.Zero)) throw new Win32Exception();
        try {
            int size = DocumentProperties(owner, printer, name, IntPtr.Zero, IntPtr.Zero, 0);
            if (size <= 0 || size > 262144) throw new InvalidOperationException("Invalid printer preferences size.");
            IntPtr mode = Marshal.AllocHGlobal(size);
            try {
                if (DocumentProperties(owner, printer, name, mode, IntPtr.Zero, 2) != 1)
                    throw new InvalidOperationException("Cannot read the printer defaults.");
                byte[] bytes = new byte[size];
                if (!String.IsNullOrEmpty(previous)) {
                    byte[] prior = Convert.FromBase64String(previous);
                    if (prior.Length != size) throw new InvalidOperationException("Printer driver changed. Reopen the print preview.");
                    Marshal.Copy(prior, 0, mode, size);
                }
                int result = DocumentProperties(owner, printer, name, mode, mode, 2 | 4 | 8);
                if (result == 2) return 2;
                if (result != 1) throw new InvalidOperationException("The printer driver could not open preferences.");
                Marshal.Copy(mode, bytes, 0, size);
                Console.WriteLine(Convert.ToBase64String(bytes));
                return 0;
            } finally { Marshal.FreeHGlobal(mode); }
        } finally { ClosePrinter(printer); }
    }

    internal static void Configure(PrintDocument job, string name, string preferences)
    {
        job.PrinterSettings.PrinterName = name;
        if (!job.PrinterSettings.IsValid) throw new InvalidOperationException("The selected printer is unavailable.");
        if (String.IsNullOrEmpty(preferences)) return;
        byte[] bytes = Convert.FromBase64String(preferences);
        IntPtr mode = Marshal.AllocHGlobal(bytes.Length);
        try {
            Marshal.Copy(bytes, 0, mode, bytes.Length);
            job.PrinterSettings.SetHdevmode(mode);
            job.DefaultPageSettings.SetHdevmode(mode);
        } finally { Marshal.FreeHGlobal(mode); }
    }
}
