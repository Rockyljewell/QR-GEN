// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
package dev.qrgen.abi;

import dev.qrgen.Barcode;
import dev.qrgen.BarcodeTracker;
import dev.qrgen.DuplicateFilter;
import dev.qrgen.Symbology;
import java.io.File;
import java.util.Arrays;
import java.util.Collections;

public final class LegacyJavaClockClient {
    private static void check(boolean value) { if (!value) throw new AssertionError("Legacy Java clock ABI failed"); }
    public static void main(String[] args) throws Exception {
        File loaded = new File(DuplicateFilter.class.getProtectionDomain().getCodeSource().getLocation().toURI());
        check(loaded.getCanonicalPath().equals(new File(System.getProperty("qrgen.expectedCore")).getCanonicalPath()));
        Barcode code = new Barcode("legacy-java", Symbology.QR);
        DuplicateFilter filter = new DuplicateFilter(1000L);
        check(filter.accept(code, 0L));
        check(!filter.accept(code, 999L));
        check(filter.accept(code, 1000L));
        check(new DuplicateFilter().accept(code));
        check(new DuplicateFilter().accept(Symbology.QR, "pair"));
        check(new DuplicateFilter().accept(Symbology.QR, "pair", 0L));
        check(new DuplicateFilter().filter(Arrays.asList(code), 0L).size() == 1);
        check(new DuplicateFilter().filter(Arrays.asList(code)).size() == 1);
        BarcodeTracker tracker = new BarcodeTracker(500L, 0.25f);
        long timestamp = code.getTimestamp();
        check(tracker.update(Arrays.asList(code), 0L).getTracked().size() == 1);
        check(tracker.update(Collections.emptyList(), 500L).getTracked().size() == 1);
        check(tracker.update(Collections.emptyList(), 501L).getRemoved().size() == 1);
        check(code.getTimestamp() == timestamp);
        check(new BarcodeTracker(500L).update(Arrays.asList(code)).getTracked().size() == 1);
        check(new BarcodeTracker().update(Arrays.asList(code)).getTracked().size() == 1);
        System.out.println("CLOCK_ABI_CLIENT java passed; loaded=" + loaded);
    }
}