// Webview HTML markup — extracted from panel.ts. Static, no template substitutions.
export const WEBVIEW_MARKUP = `
<div id="app">

  <!-- Header -->
  <header>
    <div class="logo">&#x2B21; Triforge AI Code Council</div>
    <div class="pdots">
      <span class="pdot" id="d-openai" data-p="openai">GPT</span>
      <span class="pdot" id="d-claude" data-p="claude">Claude</span>
      <span class="pdot" id="d-grok"   data-p="grok">Grok</span>
      <span id="cm-badge" class="badge hidden">FULL</span>
    </div>
    <button class="icon-btn" id="btn-cfg" title="Settings">&#x2699;</button>
  </header>

  <!-- Top bar: Prompt + Controls (always visible) -->
  <div id="topbar">
    <div id="topbar-row1">
      <div id="task-input-wrap">
        <textarea id="task-input" placeholder="Describe what you need implemented or improved&#x2026;"></textarea>
      </div>
      <div class="topbar-run">
        <button class="btn-p" id="btn-run" style="white-space:nowrap;padding:6px 12px;">Run &#x25B6;</button>
        <button class="btn-s" id="btn-run-review" style="font-size:11px;padding:3px 9px;" title="Run with Review Runtime">Review &#x25B6;</button>
        <button class="btn-s" id="btn-abort" style="font-size:11px;padding:3px 9px;display:none;">Abort</button>
        <button class="btn-g" id="btn-reset" style="font-size:11px;padding:3px 6px;">&#x21BA;</button>
      </div>
    </div>
    <div id="topbar-row2">
      <!-- Pipeline mode toggle -->
      <span style="font-size:10px;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.3px;">Pipeline:</span>
      <button class="ibtn on" data-pipe="governed" title="Plan-first governed workflow">Governed</button>
      <button class="ibtn"    data-pipe="legacy" title="Legacy code-first council">Legacy</button>
      <span style="width:1px;height:16px;background:var(--border);margin:0 4px;"></span>
      <!-- Execution mode (governed) -->
      <span id="mode-label" style="font-size:10px;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.3px;">Mode:</span>
      <button class="ibtn on" data-mode="safe" title="3 rounds, full verification">Safe</button>
      <button class="ibtn"    data-mode="quick" title="1 round, lint only">Quick</button>
      <button class="ibtn"    data-mode="trusted" title="3 rounds, auto-commit">Trusted</button>
      <span style="width:1px;height:16px;background:var(--border);margin:0 4px;"></span>
      <!-- Workflow action (governed) -->
      <span id="action-label" style="font-size:10px;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.3px;">Action:</span>
      <button class="ibtn on" data-action="plan_then_code" title="Full pipeline">Full</button>
      <button class="ibtn"    data-action="plan_only" title="Plan only">Plan</button>
      <button class="ibtn"    data-action="review_existing" title="Review existing diff">Review</button>
      <button class="ibtn"    data-action="prepare_commit" title="Evaluate git gate">Commit</button>
      <button class="btn-s" id="btn-ctx-toggle" style="font-size:11px;padding:3px 9px;margin-left:auto;">+ Context</button>
    </div>
    <!-- Legacy intensity row (hidden in governed mode) -->
    <div id="topbar-row-intensity" style="display:none;">
      <span style="font-size:10px;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.3px;">Intensity:</span>
      <button class="ibtn on" data-i="adaptive">Adaptive</button>
      <button class="ibtn"    data-i="cooperative">Cooperative</button>
      <button class="ibtn"    data-i="analytical">Analytical</button>
      <button class="ibtn"    data-i="critical">Critical</button>
      <button class="ibtn"    data-i="ruthless">Ruthless</button>
      <span id="i-auto-lbl" class="i-auto-lbl hidden"></span>
    </div>
    <div id="ctx-wrap">
      <label for="ctx-input">Code Context (optional)</label>
      <textarea id="ctx-input" placeholder="Paste the current implementation here&#x2026;"></textarea>
    </div>
    <!-- Phase steps: legacy (shown during run) -->
    <div id="topbar-phase">
      <div class="psteps">
        <span class="ps" data-ph="DRAFTING">Draft</span>
        <span class="ps" data-ph="RISK_CHECK">Risk</span>
        <span class="ps" data-ph="CRITIQUE">Critique</span>
        <span class="ps" data-ph="DEBATE">Debate</span>
        <span class="ps" data-ph="COMPLETE">&#x2713; Done</span>
      </div>
      <span id="pmsg"></span>
    </div>
    <!-- Phase steps: governed workflow (shown during governed run) -->
    <div id="workflow-phase" style="display:none;">
      <div class="psteps">
        <span class="ps wps" data-wph="intake">Intake</span>
        <span class="ps wps" data-wph="plan_draft">Plan</span>
        <span class="ps wps" data-wph="plan_review">Review</span>
        <span class="ps wps" data-wph="plan_approved">Locked</span>
        <span class="ps wps" data-wph="code_draft">Code</span>
        <span class="ps wps" data-wph="code_review">Verify</span>
        <span class="ps wps" data-wph="verifying">Checks</span>
        <span class="ps wps" data-wph="ready_to_commit">Commit</span>
        <span class="ps wps" data-wph="pushed">&#x2713; Done</span>
      </div>
      <span id="wf-msg" style="font-size:11px;color:rgba(255,255,255,0.38);"></span>
      <!-- Council role badges -->
      <div id="wf-roles" style="display:flex;gap:6px;margin-top:4px;"></div>
      <!-- Council reviews -->
      <div id="wf-reviews" style="margin-top:4px;"></div>
    </div>
    <!-- Kept for JS show/hide compat (display:none!important) -->
    <div id="s-input"  style="display:none!important;"></div>
    <div id="s-phase"  style="display:none!important;"></div>
  </div>

  <!-- Workspace: Left | Center | Right -->
  <div id="workspace">

    <!-- LEFT PANEL -->
    <div id="left-panel">

      <!-- Settings -->
      <div class="panel-sec" id="s-cfg">
        <div class="panel-sh" id="cfg-sh">Settings / API Keys
          <span id="cfg-chevron" class="panel-chevron">&#x25BE;</span>
        </div>
        <div id="cfg-body" style="display:flex;flex-direction:column;gap:8px;padding:8px 10px 14px;">
          <div class="krow"><label>OpenAI</label><input type="text" autocomplete="off" spellcheck="false" id="k-openai" placeholder="sk-..."/><button type="button" class="btn-s" id="ks-openai">Save</button><button type="button" class="btn-d" id="kr-openai">Remove</button></div>
          <div class="krow"><label>Claude</label><input type="text" autocomplete="off" spellcheck="false" id="k-claude" placeholder="sk-ant-..."/><button type="button" class="btn-s" id="ks-claude">Save</button><button type="button" class="btn-d" id="kr-claude">Remove</button></div>
          <div class="krow"><label>Grok</label><input type="text" autocomplete="off" spellcheck="false" id="k-grok" placeholder="xai-..."/><button type="button" class="btn-s" id="ks-grok">Save</button><button type="button" class="btn-d" id="kr-grok">Remove</button></div>
          <div style="border-top:1px solid var(--border);margin:2px 0;padding-top:6px;display:flex;flex-direction:column;gap:6px;">
            <datalist id="dl-openai-models"><option value="gpt-4o"/><option value="gpt-4o-mini"/><option value="o1"/><option value="o3-mini"/></datalist>
            <datalist id="dl-claude-models"><option value="claude-opus-4-6"/><option value="claude-sonnet-4-6"/><option value="claude-haiku-4-5-20251001"/></datalist>
            <datalist id="dl-grok-models"><option value="grok-3"/><option value="grok-2"/></datalist>
            <div class="krow"><label>OpenAI Model</label><input type="text" id="m-openai" list="dl-openai-models" placeholder="gpt-4o"/><button type="button" class="btn-s" id="ms-openai">Save</button></div>
            <div class="krow"><label>Claude Model</label><input type="text" id="m-claude" list="dl-claude-models" placeholder="claude-sonnet-4-6"/><button type="button" class="btn-s" id="ms-claude">Save</button></div>
            <div class="krow"><label>Grok Model</label><input type="text" id="m-grok" list="dl-grok-models" placeholder="grok-3"/><button type="button" class="btn-s" id="ms-grok">Save</button></div>
          </div>
          <div class="krow"><label>Audio</label><button class="ibtn on" id="btn-audio">On</button></div>
          <!-- License -->
          <div style="border-top:1px solid var(--border);margin:4px 0;padding-top:8px;display:flex;flex-direction:column;gap:6px;">
            <div style="display:flex;align-items:center;justify-content:space-between;">
              <span style="font-size:10px;font-weight:700;letter-spacing:0.6px;color:rgba(255,255,255,0.45);">LICENSE</span>
              <span id="lic-badge" style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:9px;background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.4);">Loading&#x2026;</span>
            </div>
            <div id="lic-msg" style="font-size:11px;color:rgba(255,255,255,0.5);line-height:1.4;"></div>
            <div id="lic-trial-bar" style="display:none;">
              <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
                <span style="font-size:10px;color:rgba(255,255,255,0.4);">Trial expires in</span>
                <span id="lic-days" style="font-size:10px;font-weight:700;color:#10b981;"></span>
              </div>
              <div style="height:3px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden;">
                <div id="lic-prog" style="height:100%;border-radius:2px;transition:width 0.4s;"></div>
              </div>
            </div>
            <div id="lic-key-row" style="display:none;flex-direction:column;gap:4px;">
              <div style="display:flex;gap:4px;">
                <input type="text" id="lic-key-inp" placeholder="Enter license key&#x2026;" style="flex:1;font-size:11px;font-family:monospace;"/>
                <button class="btn-s" id="btn-lic-activate" style="font-size:11px;padding:3px 9px;">Activate</button>
              </div>
              <div id="lic-err" style="font-size:10px;color:#ef4444;display:none;"></div>
              <button id="btn-lic-upgrade" style="width:100%;font-size:11px;background:linear-gradient(135deg,#6366f1,#818cf8);border:none;padding:5px 0;border-radius:4px;color:#fff;font-weight:600;cursor:pointer;margin-top:2px;">Subscribe &#x2014; $15/month &#x2197;</button>
            </div>
            <div id="lic-active-row" style="display:none;align-items:center;justify-content:space-between;">
              <span id="lic-key-disp" style="font-size:10px;font-family:monospace;color:rgba(255,255,255,0.4);"></span>
              <button class="btn-d" id="btn-lic-remove" style="font-size:10px;padding:2px 7px;">Remove</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Workspace Files -->
      <div class="panel-sec" id="s-explorer">
        <div class="panel-sh">Workspace Files
          <div class="meta">
            <span id="ctx-count" class="badge hidden"></span>
            <button class="btn-d" id="btn-ctx-clear" style="display:none;font-size:10px;padding:2px 6px;">Clear</button>
          </div>
        </div>
        <div class="panel-body">
          <input id="file-search" type="text" placeholder="Search files&#x2026;" style="margin-bottom:6px;"/>
          <div id="file-list" style="max-height:130px;overflow-y:auto;display:flex;flex-direction:column;gap:2px;"></div>
          <div id="ctx-files" style="margin-top:6px;display:flex;flex-direction:column;gap:2px;"></div>
        </div>
      </div>

      <!-- Git -->
      <div class="panel-sec" id="s-git">
        <div class="panel-sh">Git
          <div class="meta">
            <span id="git-branch" class="badge" style="display:none;background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.3);color:#a5b4fc;"></span>
            <button class="btn-s" id="btn-git-refresh" style="font-size:10px;padding:2px 7px;">&#x21bb;</button>
          </div>
        </div>
        <div class="panel-body" style="padding-bottom:10px;">
          <div id="git-branch-mgr" style="margin-bottom:8px;display:flex;flex-direction:column;gap:4px;">
            <div style="display:flex;gap:4px;align-items:center;">
              <select id="git-branch-select" style="flex:1;font-size:11px;background:var(--in-bg);border:1px solid var(--in-brd);color:inherit;border-radius:3px;padding:2px 4px;"></select>
              <button class="btn-s" id="btn-git-switch" style="font-size:10px;padding:2px 6px;">Switch</button>
            </div>
            <div style="display:flex;gap:4px;align-items:center;">
              <input id="git-new-branch" type="text" placeholder="new-branch-name" style="flex:1;font-size:11px;"/>
              <button class="btn-s" id="btn-git-create" style="font-size:10px;padding:2px 6px;">Create</button>
            </div>
          </div>
          <div id="git-msg-area" style="font-size:11px;color:rgba(255,255,255,0.35);padding:2px 0 6px;">Loading&#x2026;</div>
          <div id="git-staged-sec" style="display:none;margin-bottom:6px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px;">
              <span style="font-size:10px;font-weight:700;color:#10b981;letter-spacing:0.5px;">STAGED</span>
              <button class="btn-d" id="btn-unstage-all" style="font-size:10px;padding:1px 6px;">Unstage All</button>
            </div>
            <div id="git-staged" style="display:flex;flex-direction:column;gap:2px;"></div>
          </div>
          <div id="git-diff-wrap" style="display:none;margin-bottom:6px;">
            <pre id="git-diff-view" style="font-size:10px;font-family:monospace;max-height:120px;overflow-y:auto;background:rgba(0,0,0,0.25);border-radius:3px;padding:6px;white-space:pre;margin:0;line-height:1.5;"></pre>
          </div>
          <div style="margin-bottom:6px;">
            <button class="btn-s" id="btn-git-diff" style="width:100%;font-size:10px;padding:2px;">View Staged Diff</button>
          </div>
          <div id="git-changes-sec" style="display:none;margin-bottom:6px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px;">
              <span style="font-size:10px;font-weight:700;color:#f59e0b;letter-spacing:0.5px;">CHANGES</span>
              <button class="btn-s" id="btn-stage-all" style="font-size:10px;padding:1px 6px;">Stage All</button>
            </div>
            <div id="git-changes" style="display:flex;flex-direction:column;gap:2px;"></div>
          </div>
          <div style="margin-top:8px;display:flex;flex-direction:column;gap:5px;">
            <textarea id="git-commit-msg" placeholder="Commit message&#x2026;" style="width:100%;height:54px;resize:vertical;"></textarea>
            <div style="display:flex;gap:5px;">
              <button class="btn-s" id="btn-git-ai-msg" style="flex:1;">AI Message</button>
              <button class="btn-p" id="btn-git-commit" style="flex:1;">Commit</button>
              <button class="btn-s" id="btn-git-push" style="flex:1;background:rgba(99,102,241,0.15);border-color:rgba(99,102,241,0.3);color:#a5b4fc;">Push</button>
            </div>
          </div>
          <div id="git-log-sec" style="margin-top:8px;">
            <div style="font-size:10px;font-weight:700;color:rgba(255,255,255,0.25);letter-spacing:0.5px;margin-bottom:3px;">RECENT COMMITS</div>
            <div id="git-log-list" style="display:flex;flex-direction:column;gap:1px;max-height:80px;overflow-y:auto;"></div>
          </div>
        </div>
      </div>

      <!-- Prompt History -->
      <div class="panel-sec" id="s-history">
        <div class="panel-sh">Recent Prompts</div>
        <div class="panel-body">
          <div id="hist-list" style="display:flex;flex-direction:column;gap:1px;max-height:100px;overflow-y:auto;"></div>
        </div>
      </div>

    </div><!-- /left-panel -->

    <!-- CENTER PANEL: AI Council -->
    <div id="center-panel">

      <!-- License gate -->
      <div id="lic-gate" style="display:none;padding:12px;border:1px solid rgba(99,102,241,0.3);border-radius:6px;background:rgba(99,102,241,0.06);margin:8px;flex-direction:column;gap:8px;">
        <p id="lic-gate-msg" style="font-size:12px;color:rgba(255,255,255,0.65);line-height:1.5;margin:0;"></p>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button class="btn-s" id="btn-gate-upgrade" style="font-size:11px;background:linear-gradient(135deg,#6366f1,#818cf8);border:none;color:#fff;padding:4px 12px;border-radius:4px;font-weight:600;cursor:pointer;">Subscribe &#x2014; $15/mo</button>
          <button class="btn-s" id="btn-gate-key" style="font-size:11px;">I have a license key</button>
        </div>
      </div>
      <div id="bypass-b" style="display:none;padding:7px 12px;font-size:12px;background:rgba(245,158,11,0.09);border-bottom:1px solid rgba(245,158,11,0.3);color:#f59e0b;">Draft applied immediately &#x2014; council review bypassed.</div>

      <!-- Idle -->
      <div id="center-idle">
        <div style="font-size:28px;opacity:0.15;">&#x2B21;</div>
        <div>Enter a task above and click <strong>Run</strong> to convene the AI Council.</div>
        <div style="font-size:10px;margin-top:4px;opacity:0.6;">GPT &#xB7; Claude &#xB7; Grok deliberate in parallel</div>
      </div>

      <!-- Active: SVG + 3 AI Columns -->
      <div id="center-active" class="hidden">

        <!-- SVG Merge Zone -->
        <div id="s-viz" class="hidden">
          <svg id="cviz" viewBox="0 0 300 88" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <filter id="fo" x="-60%" y="-60%" width="220%" height="220%">
                <feGaussianBlur stdDeviation="3" result="b"/>
                <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
              <filter id="ft" x="-60%" y="-60%" width="220%" height="220%">
                <feGaussianBlur stdDeviation="3" result="b"/>
                <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
              <filter id="fi2" x="-80%" y="-80%" width="260%" height="260%">
                <feGaussianBlur stdDeviation="5" result="b"/>
                <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
            </defs>
            <line id="bm-claude" class="vbeam" x1="150" y1="22" x2="150" y2="46"/>
            <line id="bm-gpt"    class="vbeam" x1="50"  y1="74" x2="138" y2="55"/>
            <line id="bm-grok"   class="vbeam" x1="250" y1="74" x2="162" y2="55"/>
            <g class="vnode" id="vn-claude">
              <circle class="vn-halo" cx="150" cy="13" r="16" fill="#f97316" stroke="#f97316"/>
              <circle class="vn-core" cx="150" cy="13" r="10" filter="url(#fo)"/>
              <text x="150" y="17" text-anchor="middle" font-size="8" font-weight="800" fill="#f97316" filter="url(#fo)">C</text>
              <text x="150" y="4"  text-anchor="middle" class="vn-lbl">CLAUDE</text>
            </g>
            <g class="vnode" id="vn-gpt">
              <circle class="vn-halo" cx="40" cy="78" r="16" fill="#10b981" stroke="#10b981"/>
              <circle class="vn-core" cx="40" cy="78" r="10" filter="url(#ft)"/>
              <text x="40" y="82" text-anchor="middle" font-size="8" font-weight="800" fill="#10b981" filter="url(#ft)">G</text>
              <text x="12" y="88" text-anchor="middle" class="vn-lbl">GPT</text>
            </g>
            <g class="vnode" id="vn-grok">
              <circle class="vn-halo" cx="260" cy="78" r="16" fill="#818cf8" stroke="#818cf8"/>
              <circle class="vn-core" cx="260" cy="78" r="10" filter="url(#fi2)"/>
              <text x="260" y="82" text-anchor="middle" font-size="8" font-weight="800" fill="#818cf8" filter="url(#fi2)">X</text>
              <text x="288" y="88" text-anchor="middle" class="vn-lbl">GROK</text>
            </g>
            <g id="vn-forge">
              <circle class="vfo" cx="150" cy="55" r="22"/>
              <circle class="vfi" cx="150" cy="55" r="14" filter="url(#fi2)"/>
              <text x="150" y="61" text-anchor="middle" font-size="13" filter="url(#fi2)" style="filter:drop-shadow(0 0 5px rgba(255,210,60,.8))">&#x26A1;</text>
            </g>
          </svg>
        </div>

        <!-- 3 AI Columns -->
        <div id="ai-cols-wrap">

          <!-- GPT Column -->
          <div class="ai-col" id="col-openai">
            <div class="ai-col-hdr gpt-hdr">
              <span class="ai-col-name gpt-n">GPT</span>
              <span class="ai-state" id="col-state-openai">idle</span>
            </div>
            <div class="ai-col-body">
              <div id="col-draft-openai" style="display:none;">
                <div class="col-card"><div class="col-card-lbl">Draft</div><div class="col-rea" id="col-rea-openai"></div><pre class="col-code" id="col-code-openai"></pre></div>
              </div>
              <div id="col-risk-openai" style="display:none;">
                <div class="col-card"><div class="col-card-lbl">Risk</div><div style="font-size:11px;color:rgba(255,255,255,0.5);" id="col-risk-lbl-openai"></div></div>
              </div>
              <div id="col-cards-openai"></div>
              <div class="col-idle" id="col-idle-openai">Waiting&#x2026;</div>
            </div>
          </div>

          <!-- Claude Column -->
          <div class="ai-col" id="col-claude">
            <div class="ai-col-hdr cld-hdr">
              <span class="ai-col-name cld-n">Claude</span>
              <span class="ai-state" id="col-state-claude">idle</span>
            </div>
            <div class="ai-col-body">
              <div id="col-draft-claude" style="display:none;">
                <div class="col-card"><div class="col-card-lbl">Draft</div><div class="col-rea" id="col-rea-claude"></div><pre class="col-code" id="col-code-claude"></pre></div>
              </div>
              <div id="col-risk-claude" style="display:none;">
                <div class="col-card"><div class="col-card-lbl">Risk</div><div style="font-size:11px;color:rgba(255,255,255,0.5);" id="col-risk-lbl-claude"></div></div>
              </div>
              <div id="col-cards-claude"></div>
              <div class="col-idle" id="col-idle-claude">Waiting&#x2026;</div>
            </div>
          </div>

          <!-- Grok Column -->
          <div class="ai-col" id="col-grok">
            <div class="ai-col-hdr grk-hdr">
              <span class="ai-col-name grk-n">Grok</span>
              <span class="ai-state" id="col-state-grok">idle</span>
            </div>
            <div class="ai-col-body">
              <div id="col-draft-grok" style="display:none;">
                <div class="col-card"><div class="col-card-lbl">Draft</div><div class="col-rea" id="col-rea-grok"></div><pre class="col-code" id="col-code-grok"></pre></div>
              </div>
              <div id="col-risk-grok" style="display:none;">
                <div class="col-card"><div class="col-card-lbl">Risk</div><div style="font-size:11px;color:rgba(255,255,255,0.5);" id="col-risk-lbl-grok"></div></div>
              </div>
              <div id="col-cards-grok"></div>
              <div class="col-idle" id="col-idle-grok">Waiting&#x2026;</div>
            </div>
          </div>

        </div><!-- /ai-cols-wrap -->

        <!-- Draft/Risk/Verdicts kept hidden for JS/export compat -->
        <div class="sec hidden" id="s-draft" style="display:none!important;">
          <div class="sh">Fast Draft<div class="meta"><span id="dp-badge" class="badge">&#x2014;</span><span id="dr-badge" class="badge">&#x2014;</span><span id="dc-badge" class="badge">&#x2014;</span></div></div>
          <p id="d-reason" class="rea"></p><pre id="d-code" class="cb"></pre>
          <div class="arow"><button class="btn-s" id="btn-bypass">Apply Draft Immediately</button></div>
        </div>
        <div class="sec hidden" id="s-risk" style="display:none!important;">
          <div class="sh">Risk Analysis<div class="meta"><span id="rl-badge" class="badge">&#x2014;</span></div></div>
          <ul id="rtlist" class="tlist"></ul>
        </div>
        <div class="sec hidden" id="s-agree" style="display:none!important;">
          <div class="sh">Council Verdicts<div class="meta"><span id="cs-badge" class="badge">&#x2014;</span></div></div>
          <div id="vcards"></div>
        </div>

      </div><!-- /center-active -->

    </div><!-- /center-panel -->

    <!-- RIGHT PANEL: Final Output -->
    <div id="right-panel">

      <div id="right-idle">
        <div><div style="font-size:22px;opacity:0.15;margin-bottom:8px;">&#x25A6;</div>Final output appears here after the council completes.</div>
      </div>

      <!-- Review Runtime result -->
      <div class="sec hidden" id="s-review-runtime">
        <div class="sh">Review Runtime<div class="meta"><span id="rr-status" class="badge">&#x2014;</span></div></div>
        <div id="rr-summary" style="display:none;padding:7px 10px;border-radius:5px;margin-bottom:10px;font-size:12px;line-height:1.6;border:1px solid rgba(255,255,255,0.08);"></div>
        <div style="margin-bottom:6px;"><strong>Objective:</strong> <span id="rr-objective"></span></div>
        <div style="margin-bottom:4px;"><strong>Plan:</strong> <span id="rr-plan-summary"></span></div>
        <div style="margin-bottom:4px;"><strong>Implementation:</strong> <span id="rr-impl-summary"></span></div>
        <div style="margin-bottom:4px;"><strong>Plan Reviews:</strong><div id="rr-plan-reviews"></div></div>
        <div style="margin-bottom:4px;"><strong>Code Reviews:</strong><div id="rr-code-reviews"></div></div>
        <div style="margin-bottom:4px;"><strong>Reconciliation:</strong><div id="rr-reconciliation"></div></div>
        <div style="margin-bottom:4px;"><strong>Verification:</strong><div id="rr-verification"></div></div>
        <div style="margin-bottom:4px;"><strong>Commit message:</strong><pre id="rr-submit" class="cb" style="margin-top:4px;white-space:pre-wrap;"></pre></div>
        <div class="arow" id="rr-actions" style="display:none;">
          <button class="btn-p" id="btn-rr-copy-commit">Copy Commit</button>
          <button class="btn-s" id="btn-rr-send-commit">Send to Commit Box</button>
          <button class="btn-s" id="btn-rr-run-again">Run Again</button>
          <button class="btn-g" id="btn-rr-close">Close Review</button>
        </div>
      </div>

      <!-- Final result -->
      <div class="sec hidden" id="s-result">
        <div class="sh">Final Implementation<div class="meta"><span id="rc-badge" class="badge">&#x2014;</span></div></div>
        <pre id="r-code" class="cb"></pre>
        <div class="arow">
          <button class="btn-p" id="btn-apply">Apply Patch</button>
          <button class="btn-s" id="btn-debate">View Debate</button>
          <button class="btn-s" id="btn-esc">Escalate</button>
          <button class="btn-s" id="btn-export">Export</button>
          <button class="btn-g" id="btn-reset2">&#x21BA; New</button>
        </div>
      </div>

      <!-- Alternative -->
      <div class="sec hidden" id="s-alt">
        <div class="sh">Alternative Proposal<div class="meta"><span id="ap-badge" class="badge">&#x2014;</span><span id="ac-badge" class="badge">&#x2014;</span><span id="ar-badge" class="badge">&#x2014;</span></div></div>
        <p id="a-reason" class="rea"></p>
        <pre id="a-code" class="cb"></pre>
        <div class="arow">
          <button class="btn-p" id="btn-adopt">Adopt This</button>
          <button class="btn-s" id="btn-vote">Council Vote</button>
          <button class="btn-g" id="btn-discard">Discard</button>
        </div>
      </div>

      <!-- Synthesis note -->
      <div class="sec hidden" id="s-synth-note">
        <div class="sh">Synthesis Rationale</div>
        <p id="synth-rationale" class="rea"></p>
      </div>

    </div><!-- /right-panel -->

  </div><!-- /workspace -->

  <!-- BOTTOM PANEL: Debate + Deadlock + Critical Objection -->
  <div id="bottom-panel">
    <div id="etst"></div>

    <!-- Debate -->
    <div class="sec hidden" id="s-debate">
      <button class="cbtn" id="dtoggle">&#x1F4AC; Debate Transcript<span class="tarr" id="darr">&#x25BC;</span></button>
      <div id="dbody">
        <div class="ctrack">
          <span class="cv" id="db-c1">&#x2014;</span><span class="ca">&#x2192;</span>
          <span class="cv" id="db-c2">&#x2014;</span><span class="ca">&#x2192;</span>
          <span class="cv" id="db-c3">&#x2014;</span>
          <span id="db-dt" class="cd"></span>
        </div>
        <div class="dstage"><h4>Proposal</h4><p id="db-prop"></p></div>
        <div class="dstage"><h4>Critique</h4><p id="db-crit"></p></div>
        <div class="dstage"><h4>Revision</h4><p id="db-rev"></p></div>
        <div class="dstage"><h4>Final Decision</h4><p id="db-fin"></p></div>
        <pre id="db-fcode" class="cb" style="display:none;"></pre>
      </div>
    </div>

    <!-- Deadlock -->
    <div class="sec hidden" id="s-deadlock">
      <div class="sh">&#x26A0; Council Deadlock</div>
      <div class="sc">
        <div class="deadlock-opts">
          <button class="dopt-btn" id="btn-dl-escalate"><span class="dopt-icon">&#x1F525;</span><div><div class="dopt-title">Escalate Intensity</div><div class="dopt-desc">Re-run at higher scrutiny</div></div></button>
          <button class="dopt-btn" id="btn-dl-user"><span class="dopt-icon">&#x1F9D1;</span><div><div class="dopt-title">User Breaks Tie&#x2026;</div><div class="dopt-desc">You pick the version</div></div></button>
          <button class="dopt-btn" id="btn-dl-synthesis"><span class="dopt-icon">&#x1F9E9;</span><div><div class="dopt-title">Force Synthesis</div><div class="dopt-desc">AI merges all versions</div></div></button>
          <button class="dopt-btn" id="btn-dl-extended"><span class="dopt-icon">&#x1F4AC;</span><div><div class="dopt-title">Extended Debate</div><div class="dopt-desc">Additional reasoning round</div></div></button>
        </div>
        <div id="version-cards" class="hidden" style="display:none;flex-direction:column;gap:8px;margin-top:10px;"></div>
      </div>
    </div>

    <!-- Critical Objection -->
    <div class="sec hidden" id="s-critical-obj">
      <div class="sh">&#x26D4; Critical Objection Raised</div>
      <div class="sc">
        <div id="cobj-who" class="cobj-who"></div>
        <div id="cobj-summary" class="cobj-summary"></div>
        <div class="deadlock-opts">
          <button class="dopt-btn" id="btn-co-alt"><span class="dopt-icon">&#x1F503;</span><div><div class="dopt-title">Request Alternative</div><div class="dopt-desc">Different approach</div></div></button>
          <button class="dopt-btn dopt-danger" id="btn-co-override"><span class="dopt-icon">&#x26A0;&#xFE0F;</span><div><div class="dopt-title">Override &amp; Apply</div><div class="dopt-desc">Apply despite objection</div></div></button>
          <button class="dopt-btn" id="btn-co-debate"><span class="dopt-icon">&#x1F4AC;</span><div><div class="dopt-title">Extended Debate</div><div class="dopt-desc">Additional reasoning</div></div></button>
          <button class="dopt-btn" id="btn-co-synth"><span class="dopt-icon">&#x1F9E9;</span><div><div class="dopt-title">Force Synthesis</div><div class="dopt-desc">Merge approaches</div></div></button>
        </div>
      </div>
    </div>

  </div><!-- /bottom-panel -->

</div><!-- /app -->
`;
