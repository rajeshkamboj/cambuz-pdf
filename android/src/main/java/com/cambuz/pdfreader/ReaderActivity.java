package com.cambuz.pdfreader;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.net.Uri;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.*;
import java.io.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class ReaderActivity extends Activity {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private PdfRenderer pdf;
    private File copy;
    private Uri source;
    private int generation, page, count;
    private boolean busy;
    private Button open, previous, next;
    private TextView status;
    private ImageView image;

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        LinearLayout bar = new LinearLayout(this);
        bar.setGravity(Gravity.CENTER);
        open = button(bar, "Open PDF", () -> {
            Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("application/pdf");
            pick.addCategory(Intent.CATEGORY_OPENABLE);
            startActivityForResult(pick, 1);
        });
        previous = button(bar, "Previous", () -> display(page - 1));
        next = button(bar, "Next", () -> display(page + 1));
        root.addView(bar);
        status = new TextView(this);
        status.setGravity(Gravity.CENTER);
        status.setText("Choose a PDF to read");
        root.addView(status);
        image = new ImageView(this);
        image.setScaleType(ImageView.ScaleType.FIT_CENTER);
        root.addView(image, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(root);
        controls();
        Uri initial = saved != null ? saved.getParcelable("source") : getIntent().getData();
        if (initial != null) load(initial, saved == null ? 0 : saved.getInt("page"));
    }

    private Button button(LinearLayout bar, String label, Runnable action) {
        Button button = new Button(this);
        button.setText(label);
        button.setOnClickListener(v -> action.run());
        bar.addView(button);
        return button;
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == 1 && result == RESULT_OK && data != null && data.getData() != null)
            load(data.getData(), 0);
    }

    private void controls() {
        open.setEnabled(!busy);
        previous.setEnabled(!busy && page > 0);
        next.setEnabled(!busy && page + 1 < count);
    }

    private void load(Uri uri, int requestedPage) {
        if (!"content".equals(uri.getScheme())) return;
        int ticket = ++generation;
        source = uri;
        page = requestedPage;
        count = 0;
        busy = true;
        controls();
        image.setImageDrawable(null);
        status.setText("Opening PDF…");
        worker.execute(() -> {
            try {
                closeDocument();
                // Picker providers may return pipes. PdfRenderer needs a seekable descriptor.
                copy = File.createTempFile("reader-", ".pdf", getCacheDir());
                try (InputStream input = getContentResolver().openInputStream(uri);
                     OutputStream output = new FileOutputStream(copy)) {
                    if (input == null) throw new IOException("File unavailable");
                    byte[] buffer = new byte[65536];
                    int n;
                    while ((n = input.read(buffer)) != -1) output.write(buffer, 0, n);
                }
                ParcelFileDescriptor fd = ParcelFileDescriptor.open(copy, ParcelFileDescriptor.MODE_READ_ONLY);
                try { pdf = new PdfRenderer(fd); } catch (Exception failure) { fd.close(); throw failure; }
                int pages = pdf.getPageCount();
                if (pages < 1) throw new IOException("Empty PDF");
                runOnUiThread(() -> {
                    if (ticket != generation) return;
                    count = pages;
                    display(Math.min(Math.max(requestedPage, 0), pages - 1));
                });
            } catch (Exception error) {
                closeDocument();
                failed(ticket, "Could not open this PDF. It may be damaged or password-protected.");
            }
        });
    }

    private void display(int index) {
        if (index < 0 || index >= count) return;
        int ticket = generation;
        busy = true;
        controls();
        int width = Math.min(2400, getResources().getDisplayMetrics().widthPixels);
        worker.execute(() -> {
            try (PdfRenderer.Page sheet = pdf.openPage(index)) {
                double scale = Math.min(width / (double)sheet.getWidth(), 3200.0 / sheet.getHeight());
                Bitmap bitmap = Bitmap.createBitmap(Math.max(1, (int)(sheet.getWidth()*scale)),
                    Math.max(1, (int)(sheet.getHeight()*scale)), Bitmap.Config.ARGB_8888);
                bitmap.eraseColor(Color.WHITE);
                sheet.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                runOnUiThread(() -> {
                    if (ticket != generation) { bitmap.recycle(); return; }
                    image.setImageBitmap(bitmap);
                    page = index;
                    status.setText("Page " + (index + 1) + " of " + count);
                    busy = false;
                    controls();
                });
            } catch (Exception error) { failed(ticket, "Could not display this page."); }
        });
    }

    private void failed(int ticket, String message) {
        runOnUiThread(() -> {
            if (ticket != generation) return;
            busy = false;
            status.setText(message);
            controls();
        });
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        state.putParcelable("source", source);
        state.putInt("page", page);
    }

    private void closeDocument() {
        if (pdf != null) { pdf.close(); pdf = null; }
        if (copy != null) { copy.delete(); copy = null; }
    }

    @Override protected void onDestroy() {
        ++generation;
        worker.execute(this::closeDocument);
        worker.shutdown();
        super.onDestroy();
    }
}
