# Phone validation run sheet

This is a manual test protocol, not completed phone-test evidence. Desktop Chromium
with generated camera frames cannot establish iPhone/Android camera reliability.
The audit host had no accessible phone or mobile device tools. All physical-phone
checks below remain **unexecuted**; browser automation and CI results are recorded
separately in the stability audit.

## Record the run

Record the phone model, OS version, browser/app version, QRGen commit/build, date,
scanner mode and symbologies. Test a release built from the reviewed commit; the
public website follows `main`, so an unmerged pull request is not its deployed build.
For a comparison, record the Scandit version and settings too.

Open the [QRGen demo](https://rockyljewell.github.io/QR-GEN/demo/) on the phone over
HTTPS. Display or print test labels on another screen/sheet. Use dummy payloads,
such as `QRGEN-PHONE-TEST`, a valid EAN-13 `5901234123457`, and Code 128
`QRGEN-128`. Do not use personal identification documents for this smoke test.

## Browser smoke test

| Action | Expected result | Observed / pass-fail |
| --- | --- | --- |
| Deny camera permission, then grant it through browser settings and retry | Clear permission error; a fresh start works after permission is granted. | |
| Scan clean QR, EAN-13 and Code 128 labels in good light | Exact payload and correct format; no scan before a code is visible. | |
| Stop while a permission request or camera startup is outstanding | Camera indicator turns off after the request resolves; no late scan or ready event. | |
| Start and stop 20 times | Every start recovers; every stop releases the camera. | |
| Switch front/back cameras 20 times where available | Active preview and scanning recover; highlights from the previous view disappear. | |
| Pause, move to a different label, then resume | No callbacks while paused; the next result belongs to the resumed view. | |
| Navigate away/back or remove/reinsert the scanner | No camera left active on the removed page; controls act once after reconnect. | |
| Background/foreground the browser and lock/unlock the phone | Recovery is clear and repeatable; record any required restart. | |
| Scan two identical labels side by side in batch mode | Two visible spatial tracks and two distinct labelled buttons in the web barcode list; do not use unique-payload scan events as an item count. | |
| Choose and deselect barcodes from the list below the preview | Touch activates the intended stable row; keyboard Enter/Space and the phone's screen reader expose its payload, track identity and selected state. Selection does not depend on tapping a moving highlight. | |
| Select a label, move it out of view, then deselect it from the list | The retained row is marked selected and out of view; deselection works. The in-view count excludes it. | |
| Pause after selecting a label, then use the in-place camera switch or rotate the phone until intrinsic frame dimensions change | Old-source highlights and in-view rows/count clear; retained selections remain explicitly out of view. A newly observed identical label gets a fresh spatial ID. | |
| Recreate the scanner by changing a camera-source attribute in an integration | Previous selection clears with scanner recreation; one empty `select` reset updates the connected app. It is not carried into the new scanner session. | |
| Pause a batch scanner, then disable a currently detected barcode type | Disabled in-view rows/count clear immediately; enabled IDs remain. Chosen snapshots remain labelled out of view and can be deselected. | |
| Retry or stop from a camera-error state listener | The original start rejects, while its obsolete error event does not overwrite the replacement session or stopped UI. | |
| Scan a thin linear barcode with the front camera and repeat at different rotations | The mirrored highlight retains visible height and covers the code; choose it from the accessible list. | |
| Hide a label beyond the configured tracking timeout and show it again | Its spatial track starts fresh. This does not prove persistent physical-item identity. | |

Repeat on Safari on iPhone and Chrome on Android, including at least one older
or lower-tier phone. Record glare, low light, tilt, small labels and motion as
separate conditions; a clean-label smoke pass does not cover them.

## Native app and comparison gates

The browser demo tests the web SDK. Repeat lifecycle, camera switching and batch
tracking in native iOS/Android sample apps before claiming native phone coverage.
The accessible list described above is the web component workflow; verify each
native app's own selection controls separately.
Include interrupted permission prompts, app backgrounding and settings changes
while decoding. Run longer receiving/picking sessions to measure memory, heat,
lost actions, false positives and recovery.

Scandit's [public web demo](https://websdk.demos.scandit.com/) can be opened without
a local trial. Its version, mode and inversion settings must be recorded; the
hosted demo and QRGen UI can have different defaults. Use the same phone, labels,
distances and conditions. Report successes and failures by condition before making
any relative claim. Do not compare latency from unrelated pages or headless GPU
fallbacks. The saved [desktop public-demo matrix](public-demo-format-matrix-2026-10-11.json)
is limited to generated inputs; its inconclusive inverted PDF417 observation and
unpinned public QRGen deployment are not physical-phone failures or parity evidence.

Keep failed cases and exact reproduction steps in the issue tracker. A pass on
this run sheet is smoke-test evidence, not a stability-parity certification.
