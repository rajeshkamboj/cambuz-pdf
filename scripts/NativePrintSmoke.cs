using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Drawing.Printing;
using System.IO;
using System.IO.MemoryMappedFiles;

internal class NativePrintSmoke
{
    public static int Main(string[] args)
    {
        using (var map = MemoryMappedFile.CreateFromFile(args[0], FileMode.Open, null, 0, MemoryMappedFileAccess.Read))
        using (var view = map.CreateViewAccessor(0, 0, MemoryMappedFileAccess.Read)) {
        NativePrint.FPDF_InitLibrary();
        try {
            IntPtr doc = NativePrint.FPDF_LoadMemDocument64(view.SafeMemoryMappedViewHandle.DangerousGetHandle(), new UIntPtr((ulong)new FileInfo(args[0]).Length), IntPtr.Zero);
            if (doc == IntPtr.Zero) throw new Exception("Cannot open regression fixture.");
            try {
                if (NativePrint.FPDF_GetPageCount(doc) != 2) throw new Exception("Expected two sheets.");
                for (int i = 0; i < 2; i++) {
                    IntPtr page = NativePrint.FPDF_LoadPage(doc, i);
                    try {
                        using (Bitmap image = new Bitmap(144, 144, PixelFormat.Format32bppRgb)) {
                            NativePrint.RenderInto(page, image);
                            if (image.GetPixel(5, 5).R != 255 || image.GetPixel(72, 72).R != i * 255 ||
                                image.GetPixel(72, 72).G != 0) throw new Exception("Wrong paper or foreground color.");
                        }
                    } finally { NativePrint.FPDF_ClosePage(page); }
                }
            } finally { NativePrint.FPDF_CloseDocument(doc); }
        } finally { NativePrint.FPDF_DestroyLibrary(); }
        }
        if (NativePrint.Run(args[0], job => false) != 2) throw new Exception("Cancellation failed.");
        const string printer = "Microsoft Print to PDF";
        foreach (string installed in PrinterSettings.InstalledPrinters) {
            if (installed != printer) continue;
            int status = NativePrint.Run(args[0], delegate(PrintDocument job) {
                job.PrinterSettings.PrinterName = printer;
                job.PrinterSettings.PrintToFile = true;
                job.PrinterSettings.PrintFileName = args[1];
                return true;
            });
            if (!System.IO.File.Exists(args[1])) throw new Exception("Virtual printer produced no output.");
            return status;
        }
        Console.WriteLine("Virtual spool test skipped: Microsoft Print to PDF is unavailable.");
        return 0;
    }
}
