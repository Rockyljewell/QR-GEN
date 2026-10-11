# Phone validation run sheet

This is a manual test protocol, not completed phone-test evidence. Desktop Chromium
with generated camera frames cannot establish iPhone/Android camera reliability.
The audit host had no accessible phone or mobile device tools.

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
| Scan two identical labels side by side in batch mode | Two visible spatial tracks on platforms supporting instance tracking; do not use unique-payload scan events as an item count. | |
| Hide a label beyond the configured tracking timeout and show it again | Its spatial track starts fresh. This does not prove persistent physical-item identity. | |

Repeat on Safari on iPhone and Chrome on Android, including at least one older
or lower-tier phone. Record glare, low light, tilt, small labels and motion as
separate conditions; a clean-label smoke pass does not cover them.

## Native app and comparison gates

The browser demo tests the web SDK. Repeat lifecycle, camera switching and batch
tracking in native iOS/Android sample apps before claiming native phone coverage.
Include interrupted permission prompts, app backgrounding and settings changes
while decoding. Run longer receiving/picking sessions to measure memory, heat,
lost actions, false positives and recovery.

Scandit's [public web demo](https://websdk.demos.scandit.com/) can be opened without
a local trial. Its version, mode and inversion settings must be recorded; the
hosted demo and QRGen UI can have different defaults. Use the same phone, labels,
distances and conditions. Report successes and failures by condition before making
any relative claim. Do not compare latency from unrelated pages or headless GPU
fallbacks.

Keep failed cases and exact reproduction steps in the issue tracker. A pass on
this run sheet is smoke-test evidence, not a stability-parity certification.
