using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Drawing.Printing;
using System.IO;
using System.Runtime.InteropServices;
using System.IO.MemoryMappedFiles;
using System.Windows.Forms;

internal static class NativePrint
{
    private const string Pdfium = "pdfium.dll";
    [DllImport(Pdfium)] internal static extern void FPDF_InitLibrary();
    [DllImport(Pdfium)] internal static extern void FPDF_DestroyLibrary();
    [DllImport(Pdfium)] internal static extern IntPtr FPDF_LoadMemDocument64(IntPtr data, UIntPtr length, IntPtr password);
    [DllImport(Pdfium)] internal static extern void FPDF_CloseDocument(IntPtr doc);
    [DllImport(Pdfium)] internal static extern int FPDF_GetPageCount(IntPtr doc);
    [DllImport(Pdfium)] internal static extern IntPtr FPDF_LoadPage(IntPtr doc, int index);
    [DllImport(Pdfium)] internal static extern void FPDF_ClosePage(IntPtr page);
    [DllImport(Pdfium)] internal static extern float FPDF_GetPageWidthF(IntPtr page);
    [DllImport(Pdfium)] internal static extern float FPDF_GetPageHeightF(IntPtr page);
    [DllImport(Pdfium)] internal static extern IntPtr FPDFBitmap_CreateEx(int w, int h, int format, IntPtr data, int stride);
    [DllImport(Pdfium)] internal static extern int FPDFBitmap_FillRect(IntPtr bitmap, int x, int y, int w, int h, uint color);
    [DllImport(Pdfium)] internal static extern void FPDFBitmap_Destroy(IntPtr bitmap);
    [DllImport(Pdfium)] internal static extern void FPDF_RenderPageBitmap(IntPtr bitmap, IntPtr page, int x, int y, int w, int h, int rotation, int flags);
    [DllImport("gdi32.dll")] internal static extern int GetDeviceCaps(IntPtr dc, int index);

    private static IntPtr OpenPage(IntPtr doc, int index)
    {
        IntPtr page = FPDF_LoadPage(doc, index);
        if (page == IntPtr.Zero) throw new InvalidDataException("Cannot load sheet " + (index + 1));
        return page;
    }

    private static SizeF SheetSize(IntPtr page)
    {
        SizeF size = new SizeF(FPDF_GetPageWidthF(page) / 72f, FPDF_GetPageHeightF(page) / 72f);
        if (!(size.Width > 0 && size.Height > 0 && size.Width <= 200 && size.Height <= 200))
            throw new InvalidDataException("Unsupported PDF sheet dimensions.");
        return size;
    }

    private static void DrawSheet(IntPtr page, PrintPageEventArgs args)
    {
        SizeF sheet = SheetSize(page);
        Graphics graphics = args.Graphics;
        // PrintDocument starts at the printable origin. Locate the physical sheet
        // in the active driver orientation, including asymmetric hardware margins.
        float dpiX = graphics.DpiX, dpiY = graphics.DpiY;
        IntPtr dc = graphics.GetHdc();
        float left, top;
        try {
            left = GetDeviceCaps(dc, 112) / dpiX;
            top = GetDeviceCaps(dc, 113) / dpiY;
        } finally { graphics.ReleaseHdc(dc); }
        float paperWidth = args.PageBounds.Width / 100f, paperHeight = args.PageBounds.Height / 100f;
        float scale = Math.Min(1f, Math.Min(paperWidth / sheet.Width, paperHeight / sheet.Height));
        float width = sheet.Width * scale, height = sheet.Height * scale;
        double dpi = Math.Min(600, Math.Min(dpiX, dpiY));
        dpi = Math.Min(dpi, Math.Sqrt(16000000d / (width * height)));
        int w = Math.Max(1, (int)Math.Round(width * dpi)), h = Math.Max(1, (int)Math.Round(height * dpi));
        using (Bitmap image = new Bitmap(w, h, PixelFormat.Format32bppRgb)) {
            RenderInto(page, image);
            graphics.PageUnit = GraphicsUnit.Inch;
            graphics.DrawImage(image, new RectangleF((paperWidth-width)/2-left, (paperHeight-height)/2-top, width, height),
                new RectangleF(0, 0, w, h), GraphicsUnit.Pixel);
        }
    }

    internal static void RenderInto(IntPtr page, Bitmap image)
    {
        int w = image.Width, h = image.Height;
        BitmapData pixels = image.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, image.PixelFormat);
        try {
            IntPtr bitmap = FPDFBitmap_CreateEx(w, h, 3, pixels.Scan0, pixels.Stride); // opaque BGRx
            if (bitmap == IntPtr.Zero) throw new OutOfMemoryException("Cannot allocate print surface.");
            try {
                if (FPDFBitmap_FillRect(bitmap, 0, 0, w, h, 0xffffffff) == 0)
                    throw new InvalidOperationException("Cannot initialize white print surface.");
                FPDF_RenderPageBitmap(bitmap, page, 0, 0, w, h, 0, 0x801); // PRINTING | ANNOT
            } finally { FPDFBitmap_Destroy(bitmap); }
        } finally { image.UnlockBits(pixels); }
    }

    // The Windows regression harness supplies a file-backed printer here.
    internal static int Run(string filename, Func<PrintDocument, bool> choose)
    {
        using (var file = File.OpenRead(filename))
        using (var map = MemoryMappedFile.CreateFromFile(file, null, 0, MemoryMappedFileAccess.Read, HandleInheritability.None, true))
        using (var view = map.CreateViewAccessor(0, 0, MemoryMappedFileAccess.Read))
            return PrintMapped(view, file.Length, filename, choose);
    }

    private static int PrintMapped(MemoryMappedViewAccessor view, long length, string filename, Func<PrintDocument, bool> choose)
    {
        FPDF_InitLibrary();
        IntPtr doc = IntPtr.Zero;
        try {
            doc = FPDF_LoadMemDocument64(view.SafeMemoryMappedViewHandle.DangerousGetHandle(), new UIntPtr((ulong)length), IntPtr.Zero);
            if (doc == IntPtr.Zero) throw new InvalidDataException("PDFium could not open the prepared document.");
            int count = FPDF_GetPageCount(doc);
            if (count < 1) throw new InvalidDataException("No sheets to print.");
            using (PrintDocument job = new PrintDocument()) {
                job.DocumentName = Path.GetFileNameWithoutExtension(filename);
                job.PrintController = new StandardPrintController();
                IntPtr first = OpenPage(doc, 0);
                SizeF size;
                try { size = SheetSize(first); } finally { FPDF_ClosePage(first); }
                if (job.PrinterSettings.IsValid) {
                    foreach (PaperSize paper in job.PrinterSettings.PaperSizes) {
                        if (Math.Abs(paper.Width - Math.Min(size.Width, size.Height)*100) <= 2 &&
                            Math.Abs(paper.Height - Math.Max(size.Width, size.Height)*100) <= 2) {
                            job.DefaultPageSettings.PaperSize = paper;
                            break;
                        }
                    }
                }
                job.DefaultPageSettings.Landscape = size.Width > size.Height;
                if (!choose(job)) return 2;
                int index = 0;
                job.PrintPage += delegate(object sender, PrintPageEventArgs args) {
                    IntPtr page = OpenPage(doc, index);
                    try { DrawSheet(page, args); } finally { FPDF_ClosePage(page); }
                    args.HasMorePages = ++index < count;
                };
                job.Print();
            }
            return 0;
        } finally {
            if (doc != IntPtr.Zero) FPDF_CloseDocument(doc);
            FPDF_DestroyLibrary();
        }
    }

    [STAThread]
    private static int Main(string[] args)
    {
        try {
            Application.EnableVisualStyles();
            return Run(args[0], delegate(PrintDocument job) {
                using (PrintDialog dialog = new PrintDialog()) {
                    dialog.Document = job;
                    dialog.UseEXDialog = true;
                    return dialog.ShowDialog() == DialogResult.OK;
                }
            });
        } catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
    }
}
