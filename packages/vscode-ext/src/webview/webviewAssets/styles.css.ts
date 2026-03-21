// Webview CSS — extracted from panel.ts. Static, no template substitutions.
export const WEBVIEW_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif);
    font-size: 13px;
    color: var(--vscode-editor-foreground, #ccc);
    background: var(--vscode-editor-background, #1e1e1e);
    height: 100vh; overflow: hidden;
  }
  :root {
    --c-gpt:    #10b981; --c-claude: #f97316; --c-grok: #818cf8; --c-forge: #6366f1;
    --risk-low: #10b981; --risk-med: #f59e0b; --risk-high: #ef4444; --risk-crit: #7c3aed;
    --border:    var(--vscode-editorWidget-border, rgba(255,255,255,0.1));
    --sec-bg:    var(--vscode-sideBar-background, rgba(255,255,255,0.025));
    --btn-bg:    var(--vscode-button-background, #0e639c);
    --btn-fg:    var(--vscode-button-foreground, #fff);
    --btn-hov:   var(--vscode-button-hoverBackground, #1177bb);
    --in-bg:     var(--vscode-input-background, rgba(255,255,255,0.05));
    --in-brd:    var(--vscode-input-border, rgba(255,255,255,0.15));
  }

  /* ── Think Tank Grid Layout ─────────────────────────────────────────────── */
  #app {
    display: grid; height: 100vh; overflow: hidden;
    grid-template-rows: auto auto 1fr auto;
    grid-template-areas: "header" "topbar" "workspace" "bottom";
  }
  header {
    grid-area: header;
    display: flex; align-items: center; gap: 8px; padding: 7px 12px;
    background: var(--vscode-titleBar-activeBackground, rgba(0,0,0,0.3));
    border-bottom: 1px solid var(--border);
  }
  #topbar {
    grid-area: topbar; border-bottom: 1px solid var(--border);
    background: rgba(0,0,0,0.12); padding: 7px 10px;
    display: flex; flex-direction: column; gap: 5px;
  }
  #topbar-row1 { display: flex; gap: 6px; align-items: flex-start; }
  #task-input-wrap { flex: 1; position: relative; }
  #task-input { width: 100%; min-height: 50px; max-height: 110px; resize: vertical; }
  .topbar-run { display: flex; flex-direction: column; gap: 4px; flex-shrink: 0; }
  #topbar-row2 { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
  #ctx-wrap { display: none; margin-top: 3px; }
  #ctx-input { width: 100%; min-height: 40px; font-family: 'Menlo','Monaco','Courier New',monospace; font-size: 11px; }
  #topbar-phase { display: none; align-items: center; gap: 7px; padding: 3px 0; flex-wrap: wrap; }
  #topbar-phase.active { display: flex; }
  #pmsg { font-size: 11px; color: rgba(255,255,255,0.38); flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #workspace {
    grid-area: workspace; display: grid; overflow: hidden; min-height: 0;
    grid-template-columns: 22% 1fr 25%;
    grid-template-areas: "left center right";
  }
  #left-panel {
    grid-area: left; overflow-y: auto; border-right: 1px solid var(--border);
    display: flex; flex-direction: column;
  }
  #center-panel {
    grid-area: center; overflow-y: auto; display: flex; flex-direction: column; min-height: 0;
  }
  #right-panel {
    grid-area: right; overflow-y: auto; border-left: 1px solid var(--border);
    display: flex; flex-direction: column;
  }
  #bottom-panel {
    grid-area: bottom; border-top: 1px solid var(--border);
    overflow-y: auto; max-height: 260px;
    background: rgba(0,0,0,0.1);
  }

  /* ── Left / Panel sections ───────────────────────────────────────────────── */
  .panel-sec { border-bottom: 1px solid var(--border); }
  .panel-sh {
    display: flex; align-items: center; gap: 6px; padding: 6px 10px;
    background: rgba(255,255,255,0.02); font-size: 10px; font-weight: 700;
    letter-spacing: 0.8px; text-transform: uppercase; color: rgba(255,255,255,0.35);
    cursor: pointer; user-select: none;
  }
  .panel-sh:hover { background: rgba(255,255,255,0.04); }
  .panel-sh .meta { margin-left: auto; display: flex; gap: 5px; align-items: center; }
  .panel-chevron { margin-left: auto; font-size: 10px; color: rgba(255,255,255,0.3); transition: transform 0.15s; }
  .panel-body { padding: 8px 10px; }

  /* ── Sections (center/right) ─────────────────────────────────────────────── */
  .sec { border: 1px solid var(--border); border-radius: 6px; overflow: hidden; background: var(--sec-bg); margin: 6px; }
  .sec.hidden { display: none !important; }

  /* ── AI Columns ──────────────────────────────────────────────────────────── */
  #ai-cols-wrap { display: grid; grid-template-columns: 1fr 1fr 1fr; flex: 1; min-height: 0; overflow: hidden; }
  .ai-col { display: flex; flex-direction: column; border-right: 1px solid var(--border); min-height: 0; overflow-y: auto; }
  .ai-col:last-child { border-right: none; }
  .ai-col-hdr {
    display: flex; align-items: center; gap: 6px; padding: 6px 9px;
    border-bottom: 1px solid var(--border); font-size: 10px; font-weight: 700;
    letter-spacing: 0.8px; text-transform: uppercase; position: sticky; top: 0; z-index: 5;
    background: var(--vscode-editor-background, #1e1e1e);
  }
  .ai-col-hdr.gpt-hdr { border-top: 2px solid var(--c-gpt); }
  .ai-col-hdr.cld-hdr { border-top: 2px solid var(--c-claude); }
  .ai-col-hdr.grk-hdr { border-top: 2px solid var(--c-grok); }
  .ai-col-name { font-size: 11px; font-weight: 800; }
  .ai-col-name.gpt-n { color: var(--c-gpt); }
  .ai-col-name.cld-n { color: var(--c-claude); }
  .ai-col-name.grk-n { color: var(--c-grok); }
  .ai-state {
    font-size: 9px; font-weight: 700; letter-spacing: 0.5px; padding: 1px 5px; border-radius: 8px;
    background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.3); border: 1px solid rgba(255,255,255,0.08); margin-left: auto;
  }
  .ai-state.st-drafting  { background: rgba(249,115,22,0.12); color: #fb923c; border-color: rgba(249,115,22,0.3); animation: sp 0.9s ease-in-out infinite; }
  .ai-state.st-reviewing { background: rgba(99,102,241,0.12); color: #a5b4fc; border-color: rgba(99,102,241,0.3); animation: sp 1.4s ease-in-out infinite; }
  .ai-state.st-agreed    { background: rgba(16,185,129,0.12); color: #10b981; border-color: rgba(16,185,129,0.3); }
  .ai-state.st-disagrees { background: rgba(239,68,68,0.12);  color: #f87171; border-color: rgba(239,68,68,0.3); }
  .ai-state.st-voting    { background: rgba(59,130,246,0.12);  color: #60a5fa; border-color: rgba(59,130,246,0.3); animation: sp 1.2s ease-in-out infinite; }
  .ai-col-body { flex: 1; padding: 6px 8px; display: flex; flex-direction: column; gap: 6px; }
  .col-card { border: 1px solid rgba(255,255,255,0.07); border-radius: 5px; background: rgba(255,255,255,0.02); padding: 7px 9px; font-size: 11px; }
  .col-card-lbl { font-size: 9px; font-weight: 700; letter-spacing: 0.6px; color: rgba(255,255,255,0.3); text-transform: uppercase; margin-bottom: 4px; }
  .col-rea { font-size: 11px; color: rgba(255,255,255,0.5); font-style: italic; line-height: 1.45; }
  .col-code { font-family: 'Menlo','Monaco','Courier New',monospace; font-size: 10px; line-height: 1.45; color: rgba(255,255,255,0.75); white-space: pre-wrap; word-break: break-word; max-height: 110px; overflow: hidden; margin-top: 5px; background: rgba(0,0,0,0.2); border-radius: 3px; padding: 5px 7px; }
  .col-card.ag  { border-color: rgba(16,185,129,0.28); background: rgba(16,185,129,0.035); }
  .col-card.dis { border-color: rgba(239,68,68,0.28);  background: rgba(239,68,68,0.035); }
  .col-idle { font-size: 11px; color: rgba(255,255,255,0.16); padding: 12px 9px; text-align: center; font-style: italic; }

  /* ── Center idle / active ────────────────────────────────────────────────── */
  #center-idle {
    flex: 1; display: flex; align-items: center; justify-content: center;
    flex-direction: column; gap: 8px; color: rgba(255,255,255,0.2);
    font-size: 12px; text-align: center; padding: 20px;
  }
  #center-active { flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
  #center-active.hidden { display: none !important; }
  #right-idle { flex: 1; display: flex; align-items: center; justify-content: center; color: rgba(255,255,255,0.18); font-size: 11px; text-align: center; padding: 16px; }
  #right-idle.hidden { display: none !important; }

  /* ── Header ──────────────────────────────────────────────────────────────── */
  .logo { font-size: 11px; font-weight: 700; letter-spacing: 1px; color: rgba(255,255,255,0.5); flex-shrink: 0; }
  .pdots { display: flex; gap: 5px; flex: 1; }
  .pdot {
    font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 10px;
    background: rgba(255,255,255,0.04); color: rgba(255,255,255,0.25);
    border: 1px solid rgba(255,255,255,0.07); transition: all 0.2s;
  }
  .pdot.on { color: #fff; border-color: rgba(255,255,255,0.2); }
  .pdot[data-p="openai"].on  { background: rgba(16,185,129,0.12); border-color: #10b981; color: #10b981; }
  .pdot[data-p="claude"].on  { background: rgba(249,115,22,0.12); border-color: #f97316; color: #f97316; }
  .pdot[data-p="grok"].on    { background: rgba(129,140,248,0.12); border-color: #818cf8; color: #818cf8; }
  .icon-btn { background: none; border: none; cursor: pointer; color: rgba(255,255,255,0.4); font-size: 14px; padding: 2px 5px; border-radius: 3px; transition: color 0.15s; }
  .icon-btn:hover { color: rgba(255,255,255,0.85); }
  .icon-btn.active { color: var(--c-forge); }
  /* File explorer */
  .fitem { display:flex;align-items:center;gap:6px;padding:3px 6px;border-radius:3px;cursor:pointer;font-size:11px;font-family:monospace;color:rgba(255,255,255,0.6);transition:background 0.12s; }
  .fitem:hover { background:rgba(255,255,255,0.06); }
  .fitem.ctx-on { background:rgba(99,102,241,0.12);color:#a5b4fc; }
  .fitem .fext { font-size:9px;color:rgba(255,255,255,0.3);flex-shrink:0;width:28px;text-align:right; }
  .fitem .fname { flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;direction:rtl;text-align:left; }
  .ctx-tag { display:flex;align-items:center;gap:4px;padding:2px 7px;border-radius:3px;background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.25);font-size:10px;color:#a5b4fc;font-family:monospace; }
  .ctx-tag span { flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
  .ctx-rm { background:none;border:none;color:rgba(255,255,255,0.3);cursor:pointer;font-size:13px;padding:0 2px;line-height:1; }
  .ctx-rm:hover { color:#ef4444; }
  .gfile { display:flex;align-items:center;gap:5px;padding:2px 4px;border-radius:3px;font-size:11px;font-family:monospace; }
  .gfile .gname { flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
  .gfile .gbtn { background:none;border:1px solid rgba(255,255,255,0.15);color:rgba(255,255,255,0.5);cursor:pointer;font-size:10px;padding:1px 5px;border-radius:2px;flex-shrink:0; }
  .gfile .gbtn:hover { background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.8); }
  .gfile-staged .gname { color:#10b981; }
  .gfile-changed .gname { color:#f59e0b; }
  .gfile-untracked .gname { color:rgba(255,255,255,0.4); }
  .diff-add  { color:#10b981; }
  .diff-rm   { color:#ef4444; }
  .diff-hunk { color:#818cf8; }
  .diff-file { color:rgba(255,255,255,0.55);font-weight:700; }
  .gcommit       { display:flex;gap:6px;font-size:10px;font-family:monospace;padding:2px 3px;border-radius:2px; }
  .gcommit:hover { background:rgba(255,255,255,0.04); }
  .gcommit .ghash { color:#818cf8;flex-shrink:0; }
  .gcommit .gmsg  { color:rgba(255,255,255,0.4);overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
  .hitem { font-size:10px;padding:3px 6px;border-radius:3px;cursor:pointer;color:rgba(255,255,255,0.38);white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
  .hitem:hover { background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.7); }
  #lic-badge.lic-trial   { background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.3);color:#a5b4fc; }
  #lic-badge.lic-active  { background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.3);color:#10b981; }
  #lic-badge.lic-expired { background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.25);color:#f87171; }
  .sh {
    display: flex; align-items: center; gap: 6px; padding: 6px 11px;
    background: rgba(255,255,255,0.025); border-bottom: 1px solid var(--border);
    font-size: 10px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase;
    color: rgba(255,255,255,0.4);
  }
  .sh .meta { margin-left: auto; display: flex; gap: 5px; align-items: center; }
  .sc { padding: 9px 11px; }

  /* Badges */
  .badge {
    font-size: 10px; font-weight: 700; letter-spacing: 0.4px;
    padding: 2px 7px; border-radius: 9px;
    background: rgba(255,255,255,0.07); color: rgba(255,255,255,0.5);
    border: 1px solid rgba(255,255,255,0.1); text-transform: uppercase;
  }
  .r-low   { background: rgba(16,185,129,0.12); color: #10b981; border-color: rgba(16,185,129,0.35); }
  .r-med   { background: rgba(245,158,11,0.12); color: #f59e0b; border-color: rgba(245,158,11,0.35); }
  .r-high  { background: rgba(239,68,68,0.12);  color: #ef4444; border-color: rgba(239,68,68,0.35); }
  .r-crit  { background: rgba(124,58,237,0.12); color: #7c3aed; border-color: rgba(124,58,237,0.35); }
  .c-unani { background: rgba(16,185,129,0.12); color: #10b981; border-color: rgba(16,185,129,0.35); }
  .c-major { background: rgba(245,158,11,0.12); color: #f59e0b; border-color: rgba(245,158,11,0.35); }
  .c-split { background: rgba(239,68,68,0.12);  color: #ef4444; border-color: rgba(239,68,68,0.35); }
  .c-block { background: rgba(124,58,237,0.12); color: #7c3aed; border-color: rgba(124,58,237,0.35); }
  .p-gpt   { background: rgba(16,185,129,0.1);  color: #10b981; border-color: rgba(16,185,129,0.3); }
  .p-cld   { background: rgba(249,115,22,0.1);  color: #f97316; border-color: rgba(249,115,22,0.3); }
  .p-grk   { background: rgba(129,140,248,0.1); color: #818cf8; border-color: rgba(129,140,248,0.3); }
  .badge-ok   { background: rgba(16,185,129,0.12); color: #10b981; border-color: rgba(16,185,129,0.35); }
  .badge-warn { background: rgba(245,158,11,0.12); color: #f59e0b; border-color: rgba(245,158,11,0.35); }
  .badge-error { background: rgba(239,68,68,0.12); color: #ef4444; border-color: rgba(239,68,68,0.35); }

  /* Review Runtime */
  .rr-block { padding: 8px 11px; border-top: 1px solid rgba(255,255,255,0.05); font-size: 11px; line-height: 1.5; color: rgba(255,255,255,0.68); }
  .rr-decision { padding: 4px 0; color: rgba(255,255,255,0.68); }
  .rr-meta { color: rgba(255,255,255,0.42); font-size: 10px; }

  /* Buttons */
  button { cursor: pointer; border: none; border-radius: 4px; font-size: 12px; font-family: inherit; transition: background 0.15s; }
  .btn-p  { background: var(--btn-bg); color: var(--btn-fg); padding: 6px 14px; font-weight: 600; }
  .btn-p:hover { background: var(--btn-hov); }
  .btn-s  { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.65); padding: 5px 11px; border: 1px solid rgba(255,255,255,0.12); }
  .btn-s:hover { background: rgba(255,255,255,0.1); }
  .btn-d  { background: rgba(239,68,68,0.1); color: #ef4444; padding: 5px 11px; border: 1px solid rgba(239,68,68,0.3); }
  .btn-d:hover { background: rgba(239,68,68,0.18); }
  .btn-g  { background: none; color: rgba(255,255,255,0.35); padding: 4px 8px; font-size: 11px; }
  .btn-g:hover { color: rgba(255,255,255,0.7); }
  .arow { display: flex; gap: 7px; flex-wrap: wrap; padding: 8px 11px 11px; }

  /* Input */
  #s-input .sc { display: flex; flex-direction: column; gap: 9px; }
  label { font-size: 10px; font-weight: 700; letter-spacing: 0.3px; color: rgba(255,255,255,0.35); display: block; margin-bottom: 3px; text-transform: uppercase; }
  textarea, input[type="password"] {
    width: 100%; padding: 6px 9px;
    background: var(--in-bg); border: 1px solid var(--in-brd); border-radius: 4px;
    color: var(--vscode-editor-foreground, #ccc); font-family: inherit; font-size: 12px;
    resize: vertical; outline: none; transition: border-color 0.15s;
  }
  textarea:focus, input:focus { border-color: var(--c-forge); }
  #task-input { min-height: 68px; }
  #ctx-input { min-height: 52px; font-family: 'Menlo','Monaco','Courier New',monospace; font-size: 11px; }
  .irow { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .irow span { font-size: 10px; color: rgba(255,255,255,0.35); text-transform: uppercase; letter-spacing: 0.3px; }
  .ibtn {
    font-size: 11px; padding: 3px 9px; border-radius: 10px;
    background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.45); border: 1px solid rgba(255,255,255,0.1);
    transition: all 0.15s;
  }
  .ibtn:hover { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.75); }
  .ibtn.on { background: rgba(99,102,241,0.18); color: #818cf8; border-color: rgba(99,102,241,0.5); }
  #btn-run { margin-left: auto; }

  /* Council visualization */
  #s-viz { background: rgba(0,0,0,0.18); }
  #cviz { display: block; width: 100%; max-height: 124px; }
  .vn-halo { fill-opacity: 0; stroke-opacity: 0; transition: all 0.4s; transform-box: fill-box; transform-origin: center; }
  .vn-core { fill: rgba(255,255,255,0.04); stroke: rgba(255,255,255,0.12); stroke-width: 1.5; transition: all 0.35s; }
  .vn-lbl  { font-size: 7.5px; font-weight: 800; fill: rgba(255,255,255,0.28); letter-spacing: 1px; transition: fill 0.35s; }
  .vbeam   { stroke: rgba(255,255,255,0.07); stroke-width: 1; stroke-dasharray: 4 9; transition: stroke 0.35s; }
  .vbeam.fl { stroke-dashoffset: 13; animation: bflow 1s linear infinite; }
  .vfo { fill: none; stroke: rgba(99,102,241,0.14); stroke-width: 1; }
  .vfi { fill: rgba(99,102,241,0.08); stroke: #6366f1; stroke-width: 1.5; transition: all 0.35s; }

  /* Node states */
  .vnode.drafting .vn-halo { fill-opacity: 0.14; stroke-opacity: 0.55; animation: hp 0.9s ease-in-out infinite; }
  .vnode.drafting .vn-core { fill: rgba(249,115,22,0.14); stroke: #f97316; }
  .vnode.drafting .vn-lbl  { fill: #fb923c; }
  .vnode.reviewing .vn-halo { fill-opacity: 0.1; stroke-opacity: 0.4; animation: hp 1.5s ease-in-out infinite; }
  .vnode.reviewing .vn-core { fill: rgba(99,102,241,0.1); stroke: #818cf8; }
  .vnode.reviewing .vn-lbl  { fill: #818cf8; }
  .vnode.agreed .vn-core   { fill: rgba(16,185,129,0.14); stroke: #10b981; stroke-width: 2; }
  .vnode.agreed .vn-lbl    { fill: #10b981; }
  .vnode.disagreed .vn-core { fill: rgba(239,68,68,0.14); stroke: #ef4444; stroke-width: 2; }
  .vnode.disagreed .vn-lbl  { fill: #ef4444; }
  .vnode.disagreed           { animation: shake 0.4s ease-in-out; }
  .forge-pulse .vfi { animation: fp 0.9s ease-in-out infinite; }
  .forge-unani .vfi { stroke: #10b981; fill: rgba(16,185,129,0.1); }
  .forge-split .vfi { stroke: #ef4444; fill: rgba(239,68,68,0.08); }

  @keyframes bflow { from { stroke-dashoffset: 13; } to { stroke-dashoffset: 0; } }
  @keyframes hp { 0%,100% { transform: scale(1); opacity: 0.4; } 50% { transform: scale(1.25); opacity: 0.75; } }
  @keyframes shake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-3px); } 75% { transform: translateX(3px); } }
  @keyframes fp { 0%,100% { opacity: 0.65; } 50% { opacity: 1; } }

  /* Phase bar */
  #s-phase .sc { display: flex; align-items: center; gap: 7px; padding: 7px 11px; flex-wrap: wrap; }
  .psteps { display: flex; gap: 4px; }
  .ps {
    font-size: 9.5px; font-weight: 700; padding: 2px 8px; border-radius: 9px; letter-spacing: 0.3px;
    background: rgba(255,255,255,0.04); color: rgba(255,255,255,0.22); border: 1px solid rgba(255,255,255,0.06);
    transition: all 0.25s;
  }
  .ps.active { background: rgba(99,102,241,0.18); color: #818cf8; border-color: rgba(99,102,241,0.45); animation: sp 1.1s ease-in-out infinite; }
  .ps.done   { background: rgba(16,185,129,0.1);  color: #10b981; border-color: rgba(16,185,129,0.28); }
  @keyframes sp { 0%,100% { opacity: 0.75; } 50% { opacity: 1; } }
  #pmsg { font-size: 11px; color: rgba(255,255,255,0.38); flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* Governed workflow phases */
  .ps.blocked { background: rgba(239,68,68,0.12); color: #ef4444; border-color: rgba(239,68,68,0.3); }
  #workflow-phase { display: none; padding: 3px 0; }
  #workflow-phase.active { display: flex; flex-direction: column; gap: 4px; }
  .wf-role-badge {
    font-size: 9px; font-weight: 700; padding: 2px 7px; border-radius: 8px;
    letter-spacing: 0.3px; text-transform: uppercase;
  }
  .wf-role-badge[data-role="architect"]   { background: rgba(249,115,22,0.12); color: #f97316; border: 1px solid rgba(249,115,22,0.3); }
  .wf-role-badge[data-role="precision"]   { background: rgba(16,185,129,0.12); color: #10b981; border: 1px solid rgba(16,185,129,0.3); }
  .wf-role-badge[data-role="adversarial"] { background: rgba(129,140,248,0.12); color: #818cf8; border: 1px solid rgba(129,140,248,0.3); }
  .wf-review-entry {
    font-size: 11px; padding: 3px 8px; margin: 2px 0; border-radius: 3px;
    display: flex; align-items: center; gap: 6px;
  }
  .wf-review-entry.approved { border-left: 2px solid #10b981; background: rgba(16,185,129,0.05); }
  .wf-review-entry.objected { border-left: 2px solid #ef4444; background: rgba(239,68,68,0.05); }
  .wf-check-badge {
    font-size: 9px; font-weight: 600; padding: 1px 6px; border-radius: 6px;
    display: inline-flex; align-items: center; gap: 3px;
  }
  .wf-check-badge.pass { background: rgba(16,185,129,0.12); color: #10b981; }
  .wf-check-badge.fail { background: rgba(239,68,68,0.12); color: #ef4444; }
  #wf-plan-preview, #wf-code-preview {
    margin: 6px; padding: 8px 11px; border: 1px solid var(--border); border-radius: 6px;
    background: var(--sec-bg); font-size: 12px;
  }
  .wf-file-entry { padding: 3px 0; border-bottom: 1px solid rgba(255,255,255,0.04); }
  .wf-file-path { font-family: monospace; font-size: 11px; color: rgba(255,255,255,0.7); }
  .wf-file-why  { font-size: 11px; color: rgba(255,255,255,0.4); font-style: italic; }

  /* Code blocks */
  .cb {
    background: rgba(0,0,0,0.22); border: 1px solid rgba(255,255,255,0.07); border-radius: 4px;
    padding: 9px 11px; margin: 0 11px 9px;
    font-family: 'Menlo','Monaco','Courier New',monospace; font-size: 11px; line-height: 1.5;
    color: rgba(255,255,255,0.82); white-space: pre-wrap; word-break: break-word;
    overflow-x: auto; max-height: 300px; overflow-y: auto;
  }
  .rea { padding: 7px 11px 5px; font-size: 12px; line-height: 1.5; color: rgba(255,255,255,0.5); font-style: italic; }

  /* Risk */
  .tlist { padding: 4px 11px 9px; list-style: none; display: flex; flex-direction: column; gap: 3px; }
  .tlist li { font-size: 11px; padding: 3px 8px; background: rgba(239,68,68,0.05); border-left: 2px solid rgba(239,68,68,0.4); color: rgba(255,255,255,0.6); border-radius: 0 3px 3px 0; }
  .tlist li.ok { border-left-color: rgba(16,185,129,0.4); color: #10b981; background: rgba(16,185,129,0.05); }

  /* Verdict cards */
  #vcards { display: flex; flex-direction: column; gap: 5px; padding: 5px 11px 9px; }
  .vcard { padding: 7px 10px; border-radius: 5px; border: 1px solid rgba(255,255,255,0.07); background: rgba(255,255,255,0.02); }
  .vcard.ag { border-color: rgba(16,185,129,0.28); background: rgba(16,185,129,0.035); }
  .vcard.dis { border-color: rgba(239,68,68,0.28);  background: rgba(239,68,68,0.035); }
  .vrow { display: flex; align-items: center; gap: 5px; margin-bottom: 3px; }
  .vicon { font-size: 13px; }
  .vpro  { font-size: 11px; font-weight: 700; }
  .vcon  { font-size: 10px; color: rgba(255,255,255,0.36); }
  .vobjl { list-style: none; margin-top: 3px; }
  .vobjl li { font-size: 11px; color: rgba(255,255,255,0.52); padding: 1px 0; }
  .vobjl li::before { content: "\\2022 "; color: #ef4444; }
  .vsugl li { font-size: 11px; color: rgba(255,255,255,0.42); padding: 1px 0; }
  .vsugl li::before { content: "\\2192 "; color: #818cf8; }

  /* Confidence track */
  .ctrack { display: flex; align-items: center; gap: 7px; padding: 5px 11px 7px; font-size: 12px; }
  .cv { font-weight: 700; }
  .ca { color: rgba(255,255,255,0.28); }
  .cd { font-size: 11px; padding: 2px 6px; border-radius: 9px; }
  .cd.up   { background: rgba(16,185,129,0.14); color: #10b981; }
  .cd.down { background: rgba(239,68,68,0.14);  color: #ef4444; }

  /* Debate section */
  .dstage { padding: 7px 11px; border-bottom: 1px solid rgba(255,255,255,0.04); }
  .dstage:last-child { border-bottom: none; }
  .dstage h4 { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: rgba(255,255,255,0.3); margin-bottom: 3px; }
  .dstage p  { font-size: 12px; color: rgba(255,255,255,0.6); line-height: 1.45; }
  .cbtn {
    width: 100%; text-align: left; background: rgba(255,255,255,0.025);
    border: none; border-bottom: 1px solid var(--border); cursor: pointer;
    color: rgba(255,255,255,0.45); display: flex; align-items: center; gap: 6px;
    padding: 7px 11px; font-size: 10px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase;
    transition: background 0.15s;
  }
  .cbtn:hover { background: rgba(255,255,255,0.05); }
  .cbtn .tarr { margin-left: auto; font-size: 9px; }
  #dbody { display: none; }
  #dbody.open { display: block; }

  /* Settings */
  .krow { display: flex; align-items: center; gap: 7px; padding: 5px 11px; }
  .krow label { min-width: 50px; margin-bottom: 0; }
  .krow input { flex: 1; resize: none; }

  /* Error toast */
  #etst {
    position: fixed; bottom: 14px; right: 14px; left: 14px;
    background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.35);
    color: #ef4444; border-radius: 5px; padding: 8px 12px;
    font-size: 12px; display: none; z-index: 100;
    animation: fi 0.2s ease;
  }
  .toast-ok { background: rgba(16,185,129,0.1) !important; border-color: rgba(16,185,129,0.35) !important; color: #10b981 !important; }
  @keyframes fi { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }
  #bypass-b { background: rgba(245,158,11,0.09); border: 1px solid rgba(245,158,11,0.3); color: #f59e0b; padding: 7px 12px; font-size: 12px; border-radius: 5px; display: none; }

  /* Offline node state */
  .vnode.offline .vn-core { stroke-dasharray: 4 3; fill: rgba(255,255,255,0.01); stroke: rgba(255,255,255,0.15); opacity: 0.3; }
  .vnode.offline .vn-lbl  { fill: rgba(255,255,255,0.2); opacity: 0.3; }

  /* New node states */
  .vnode.analyzing .vn-halo { fill-opacity:0.15; stroke-opacity:0.6; animation:hp 0.6s ease-in-out infinite; }
  .vnode.analyzing .vn-core { fill:rgba(99,102,241,0.18); stroke:#818cf8; }
  .vnode.analyzing .vn-lbl  { fill:#c4b5fd; }
  .vnode.challenging .vn-halo { fill-opacity:0.2; stroke-opacity:0.7; animation:hp 0.4s ease-in-out infinite; }
  .vnode.challenging .vn-core { fill:rgba(245,158,11,0.18); stroke:#f59e0b; }
  .vnode.challenging .vn-lbl  { fill:#fbbf24; }
  .vnode.voting .vn-halo { fill-opacity:0.12; stroke-opacity:0.5; animation:hp 1.2s ease-in-out infinite; }
  .vnode.voting .vn-core { fill:rgba(59,130,246,0.14); stroke:#3b82f6; }
  .vnode.voting .vn-lbl  { fill:#60a5fa; }
  .vnode.synthesizing .vn-halo { fill-opacity:0.18; stroke-opacity:0.65; animation:hp 0.8s ease-in-out infinite; }
  .vnode.synthesizing .vn-core { fill:rgba(234,179,8,0.14); stroke:#eab308; }
  .vnode.synthesizing .vn-lbl  { fill:#facc15; }

  /* Depth activation */
  #s-viz { transition: box-shadow 220ms cubic-bezier(0.4,0,0.2,1); }
  #s-viz.depth-active { box-shadow: 0 6px 28px rgba(0,0,0,0.4), 0 2px 8px rgba(99,102,241,0.12); }
  .vnode { transition: transform 220ms cubic-bezier(0.4,0,0.2,1), filter 220ms cubic-bezier(0.4,0,0.2,1); }
  .vnode.depth-on { transform: translateY(-4px) scale(1.02); filter: drop-shadow(0 4px 10px rgba(0,0,0,0.45)); }
  body.ruthless-active .vnode.depth-on { transform: translateY(-6px) scale(1.03); }

  /* Critical objection section */
  .cobj-who { font-size:12px; font-weight:700; color:#ef4444; margin-bottom:5px; }
  .cobj-summary {
    font-size:12px; color:rgba(255,255,255,0.55); background:rgba(239,68,68,0.05);
    border-left:2px solid rgba(239,68,68,0.4); padding:6px 10px; border-radius:0 4px 4px 0; margin-bottom:8px;
  }
  .dopt-danger:hover { background:rgba(239,68,68,0.1) !important; border-color:rgba(239,68,68,0.4) !important; }
  #s-critical-obj .sh { color:#ef4444; }

  /* Council mode badge */
  .badge.cm-full    { background: rgba(16,185,129,0.12); color: #10b981; border-color: rgba(16,185,129,0.35); }
  .badge.cm-partial { background: rgba(245,158,11,0.12); color: #f59e0b; border-color: rgba(245,158,11,0.35); }
  .badge.cm-solo    { background: rgba(239,68,68,0.12);  color: #ef4444; border-color: rgba(239,68,68,0.35); }

  /* Intensity auto label */
  .i-auto-lbl { font-size: 10px; color: rgba(255,255,255,0.38); font-style: italic; }

  /* Deadlock section */
  .deadlock-opts { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
  .dopt-btn {
    display: flex; align-items: center; gap: 10px;
    background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1);
    border-radius: 6px; padding: 10px 12px; cursor: pointer; text-align: left;
    transition: background 0.15s, border-color 0.15s; color: var(--vscode-editor-foreground, #ccc);
    font-family: inherit;
  }
  .dopt-btn:hover { background: rgba(99,102,241,0.1); border-color: rgba(99,102,241,0.4); }
  .dopt-icon { font-size: 18px; flex-shrink: 0; }
  .dopt-title { font-size: 12px; font-weight: 700; color: rgba(255,255,255,0.85); }
  .dopt-desc  { font-size: 10px; color: rgba(255,255,255,0.4); margin-top: 2px; }

  /* Forge deadlock state (amber tension) */
  .forge-deadlock .vfi { stroke: #f59e0b; fill: rgba(245,158,11,0.08); animation: fp 0.7s ease-in-out infinite; }

  /* Version cards */
  .vc-card {
    border: 1px solid rgba(255,255,255,0.1); border-radius: 5px;
    background: rgba(255,255,255,0.02); padding: 8px 10px;
  }
  .vc-header { display: flex; align-items: center; gap: 7px; margin-bottom: 5px; }
  .vc-code { font-family: 'Menlo','Monaco','Courier New',monospace; font-size: 10px; color: rgba(255,255,255,0.55); white-space: pre-wrap; max-height: 80px; overflow: hidden; background: rgba(0,0,0,0.2); border-radius: 3px; padding: 5px 7px; margin-bottom: 5px; }
`;
