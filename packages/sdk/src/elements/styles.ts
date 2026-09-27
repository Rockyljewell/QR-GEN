export const SCANNER_CSS = /* css */ `
:host {
  --qrgen-accent: #5cc9d6;
  --qrgen-accent-contrast: #062029;
  --qrgen-radius: 0px;
  --qrgen-font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  display: block;
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 280px;
  overflow: hidden;
  background: #05070a;
  color: #fff;
  border-radius: var(--qrgen-radius);
  font-family: var(--qrgen-font);
  -webkit-tap-highlight-color: transparent;
  contain: layout paint;
  user-select: none;
}
:host([hidden]) { display: none; }
* { box-sizing: border-box; }
.root { position: absolute; inset: 0; }
video {
  position: absolute; inset: 0; width: 100%; height: 100%;
  object-fit: cover; background: #05070a;
}
video.mirror { transform: scaleX(-1); }
canvas.overlay { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.hit { position: absolute; inset: 0; }

/* Viewfinder */
.vf { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); pointer-events: none; transition: width .25s ease, height .25s ease, opacity .2s; }
.vf.hidden { opacity: 0; }
.vf .shade { position: absolute; inset: 0; border-radius: 18px; box-shadow: 0 0 0 200vmax rgba(3, 6, 10, .42); }
.vf .c { position: absolute; width: 34px; height: 34px; border: 4px solid #fff; filter: drop-shadow(0 1px 2px rgba(0,0,0,.4)); transition: border-color .2s; }
.vf .tl { left: -2px; top: -2px; border-right: 0; border-bottom: 0; border-top-left-radius: 18px; }
.vf .tr { right: -2px; top: -2px; border-left: 0; border-bottom: 0; border-top-right-radius: 18px; }
.vf .bl { left: -2px; bottom: -2px; border-right: 0; border-top: 0; border-bottom-left-radius: 18px; }
.vf .br { right: -2px; bottom: -2px; border-left: 0; border-top: 0; border-bottom-right-radius: 18px; }
.vf.hit-ok .c { border-color: var(--qrgen-accent); }
.vf .laser { display: none; position: absolute; left: 6%; right: 6%; top: 50%; height: 2px; border-radius: 2px; background: var(--qrgen-accent); box-shadow: 0 0 12px 2px var(--qrgen-accent); animation: laser 1.6s ease-in-out infinite; }
.vf.line .laser { display: block; }
.vf.line .laser { animation: pulse 1.4s ease-in-out infinite; }
.vf.frame .laser.sweep { display: block; }
@keyframes laser { 0%, 100% { top: 12%; } 50% { top: 88%; } }
@keyframes pulse { 0%, 100% { opacity: .45; } 50% { opacity: 1; } }

/* Hint + toast */
.hint {
  position: absolute; left: 50%; bottom: 84px; transform: translateX(-50%);
  max-width: calc(100% - 32px); padding: 8px 14px; border-radius: 999px;
  background: rgba(10, 14, 20, .62); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  font-size: 13px; line-height: 1.3; text-align: center; color: rgba(255,255,255,.9); pointer-events: none;
  transition: opacity .2s;
}
.toast {
  position: absolute; left: 50%; top: 16px; transform: translate(-50%, -140%);
  display: flex; align-items: center; gap: 10px; max-width: calc(100% - 128px);
  padding: 8px 14px 8px 8px; border-radius: 999px;
  background: rgba(12, 16, 22, .82); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255,255,255,.12); box-shadow: 0 10px 30px rgba(0,0,0,.35);
  transition: transform .28s cubic-bezier(.2,.9,.3,1.2), opacity .2s; opacity: 0; pointer-events: none;
}
.toast.show { transform: translate(-50%, 0); opacity: 1; pointer-events: auto; }
.toast .ok { flex: none; display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: var(--qrgen-accent); color: var(--qrgen-accent-contrast); }
.toast .txt { min-width: 0; display: flex; flex-direction: column; }
.toast .sym { font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: rgba(255,255,255,.62); }
.toast .data { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* Controls */
.bar { position: absolute; left: 0; right: 0; display: flex; justify-content: space-between; align-items: center; padding: 12px; pointer-events: none; }
.bar.top { top: 0; }
.bar.bottom { bottom: 0; justify-content: center; gap: 14px; padding-bottom: 18px; }
.bar > * { pointer-events: auto; }
.group { display: flex; gap: 10px; }
button { font: inherit; color: inherit; }
.btn {
  display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; border: 1px solid rgba(255,255,255,.14);
  background: rgba(12, 16, 22, .55); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); cursor: pointer; transition: background .15s, transform .1s;
}
.btn:hover { background: rgba(30, 36, 46, .7); }
.btn:active { transform: scale(.94); }
.btn.on { background: #fff; color: #0b0f14; }
.btn[hidden] { display: none; }
.pill {
  height: 40px; min-width: 56px; padding: 0 14px; border-radius: 999px; border: 1px solid rgba(255,255,255,.14);
  background: rgba(12, 16, 22, .55); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); font-size: 14px; font-weight: 600; cursor: pointer;
}
.pill[hidden] { display: none; }
.count {
  display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 16px; border-radius: 999px;
  background: var(--qrgen-accent); color: var(--qrgen-accent-contrast); font-weight: 700; font-size: 14px; box-shadow: 0 8px 24px rgba(0,0,0,.3);
}
.count[hidden] { display: none; }

/* Screens */
.screen {
  position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px;
  padding: 24px; text-align: center; background: radial-gradient(120% 90% at 50% 0%, #17283d 0%, #07090d 70%);
}
.screen[hidden] { display: none; }
.screen .icon { display: grid; place-items: center; width: 64px; height: 64px; border-radius: 20px; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); color: var(--qrgen-accent); }
.screen h3 { margin: 0; font-size: 17px; font-weight: 650; }
.screen p { margin: 0; max-width: 34ch; font-size: 14px; line-height: 1.45; color: rgba(255,255,255,.7); }
.cta {
  margin-top: 4px; height: 44px; padding: 0 22px; border-radius: 10px; border: 0; cursor: pointer;
  background: var(--qrgen-accent); color: var(--qrgen-accent-contrast); font-weight: 700; font-size: 15px;
}
.cta:focus-visible, .btn:focus-visible, .pill:focus-visible { outline: 2px solid var(--qrgen-accent); outline-offset: 2px; }
.spinner { width: 34px; height: 34px; border-radius: 50%; border: 3px solid rgba(255,255,255,.15); border-top-color: var(--qrgen-accent); animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.again {
  position: absolute; left: 50%; bottom: 24px; transform: translateX(-50%); height: 44px; padding: 0 22px; border-radius: 999px; border: 0; cursor: pointer;
  background: var(--qrgen-accent); color: var(--qrgen-accent-contrast); font-weight: 700; box-shadow: 0 10px 30px rgba(0,0,0,.35);
}
.again[hidden] { display: none; }
:host([controls="none"]) .bar, :host([controls="none"]) .again { display: none; }
@media (prefers-reduced-motion: reduce) { .vf .laser, .spinner { animation: none; } .toast { transition: none; } }
`;
