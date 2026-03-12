// ── ShadowTraderBottomDock.tsx ────────────────────────────────────────────────
//
// Tabbed bottom dock for secondary tools in the Shadow Trader workspace.
// Tabs: Positions | Orders | Decision Log | Journal | Analytics | Inspector

import React, { useState } from 'react';
import { SimulatorPositionsPanel } from './SimulatorPositionsPanel';
import { CouncilDecisionPanel } from './CouncilDecisionPanel';
import { ReviewedIntentsPanel } from './ReviewedIntentsPanel';
import { JournalPanel } from './JournalPanel';
import { ExpectancyPanel } from './ExpectancyPanel';
import { CouncilEffectivenessPanel } from './CouncilEffectivenessPanel';
import { AdvisoryTargetPanel } from './AdvisoryTargetPanel';
import { CalibrationPanel } from './CalibrationPanel';
import { TrustEvidencePanel } from './TrustEvidencePanel';
import { LevelMapPanel } from './LevelMapPanel';
import { RoutePanel } from './RoutePanel';
import { WatchPanel } from './WatchPanel';
import { NewsCalendarPanel } from './NewsCalendarPanel';
import { SessionRegimePanel } from './SessionRegimePanel';
import { PipelineStatusPanel } from './PipelineStatusPanel';
import { ShadowTradeCard } from './ShadowTradeCard';

// ── Types ────────────────────────────────────────────────────────────────────

type DockTab = 'positions' | 'orders' | 'decisions' | 'journal' | 'analytics' | 'inspector' | 'settings';

interface ShadowTraderBottomDockProps {
  // Positions tab
  simPositions: { open: any[]; closed: any[]; orders: any[] };
  shadow: any;
  // Orders tab
  accountState: any;
  // Decisions tab
  reviewedIntents: any[];
  simulatorState: any;
  // Journal tab
  journalEntries: any[];
  journalFilterSymbol: string;
  journalFilterOutcome: string;
  onFilterSymbolChange: (v: string) => void;
  onFilterOutcomeChange: (v: string) => void;
  expectancySummary: any;
  expectancyDimension: string;
  onExpectancyDimensionChange: (d: string) => void;
  councilEffectSummary: any;
  advisoryTargetSummary: any;
  calibrationSuggestions: any[];
  // Analytics tab
  setupTrustRecords: any[];
  activeSetupFamily: string | null;
  activeRegime: string | null;
  blockedEvals: any[];
  snapshot: any;
  // Inspector tab
  levelMap: any;
  pathPrediction: any;
  watches: any[];
  sessionContext: any;
  blockedEvaluations: any[];
  reliability: any;
  // Settings tab (render props for connection form + account settings)
  renderConnectionForm?: () => React.ReactNode;
  renderAccountSettings?: () => React.ReactNode;
  renderManualSetup?: () => React.ReactNode;
  // Dock state
  collapsed: boolean;
  onToggleCollapsed: () => void;
  externalActiveTab?: DockTab;
  onTabChange?: (tab: DockTab) => void;
}

const TABS: { key: DockTab; label: string }[] = [
  { key: 'positions', label: 'Positions' },
  { key: 'orders', label: 'Orders' },
  { key: 'decisions', label: 'Decision Log' },
  { key: 'journal', label: 'Journal' },
  { key: 'analytics', label: 'Analytics' },
  { key: 'inspector', label: 'Inspector' },
  { key: 'settings', label: 'Settings' },
];

export function ShadowTraderBottomDock(props: ShadowTraderBottomDockProps) {
  const [internalTab, setInternalTab] = useState<DockTab>('positions');
  const activeTab = props.externalActiveTab ?? internalTab;
  const setActiveTab = (tab: DockTab) => { setInternalTab(tab); props.onTabChange?.(tab); };

  return (
    <div style={{ ...s.dock, ...(props.collapsed ? s.dockCollapsed : {}) }}>
      {/* Tab bar */}
      <div style={s.tabBar}>
        {TABS.map(tab => (
          <button
            key={tab.key}
            style={{ ...s.tab, ...(activeTab === tab.key ? s.tabActive : {}) }}
            onClick={() => { if (props.collapsed) props.onToggleCollapsed(); setActiveTab(tab.key); }}
          >
            {tab.label}
          </button>
        ))}
        <button style={s.collapseBtn} onClick={props.onToggleCollapsed}>
          {props.collapsed ? '\u25B2' : '\u25BC'}
        </button>
      </div>

      {/* Tab content */}
      {!props.collapsed && (
        <div style={s.tabContent}>
          {activeTab === 'positions' && (
            <SimulatorPositionsPanel
              open={props.simPositions.open}
              closed={props.simPositions.closed}
              orders={props.simPositions.orders}
            />
          )}

          {activeTab === 'orders' && (
            <div style={s.ordersContent}>
              {props.accountState?.workingOrders?.length > 0 ? (
                <table style={s.orderTable}>
                  <thead>
                    <tr>
                      <th style={s.th}>Symbol</th><th style={s.th}>Side</th><th style={s.th}>Qty</th>
                      <th style={s.th}>Type</th><th style={s.th}>Limit</th><th style={s.th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {props.accountState.workingOrders.map((o: any, i: number) => (
                      <tr key={i}>
                        <td style={s.td}>{o.symbol}</td>
                        <td style={{ ...s.td, color: o.side === 'Buy' ? '#34d399' : '#f87171' }}>{o.side}</td>
                        <td style={s.td}>{o.qty}</td>
                        <td style={s.td}>{o.orderType}</td>
                        <td style={s.td}>{o.limitPrice?.toFixed(2) ?? '—'}</td>
                        <td style={s.td}>{o.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div style={s.emptyText}>No working orders.</div>
              )}
            </div>
          )}

          {activeTab === 'decisions' && (
            <>
              <CouncilDecisionPanel reviewed={props.reviewedIntents} />
              <ReviewedIntentsPanel reviewed={props.reviewedIntents} />
              {props.simulatorState?.active && (() => {
                const pending = props.simulatorState.pendingIntents?.[0];
                const recent = props.reviewedIntents[0];
                if (pending) return <ShadowTradeCard intent={pending} outcome="pending" />;
                if (recent?.intent?.score) return <ShadowTradeCard intent={recent.intent} outcome={recent.outcome} reason={recent.reason} />;
                return null;
              })()}
            </>
          )}

          {activeTab === 'journal' && (
            <>
              <JournalPanel
                entries={props.journalEntries}
                filterSymbol={props.journalFilterSymbol}
                filterOutcome={props.journalFilterOutcome}
                onFilterSymbolChange={props.onFilterSymbolChange}
                onFilterOutcomeChange={props.onFilterOutcomeChange}
              />
              <ExpectancyPanel
                summary={props.expectancySummary}
                dimension={props.expectancyDimension as any}
                onDimensionChange={props.onExpectancyDimensionChange}
              />
              <CouncilEffectivenessPanel summary={props.councilEffectSummary} />
              <AdvisoryTargetPanel summary={props.advisoryTargetSummary} />
              <CalibrationPanel suggestions={props.calibrationSuggestions} />
            </>
          )}

          {activeTab === 'analytics' && (
            <>
              {props.setupTrustRecords.length > 0 && (
                <TrustEvidencePanel
                  records={props.setupTrustRecords}
                  activeSetupFamily={props.activeSetupFamily}
                  activeRegime={props.activeRegime}
                />
              )}
              <PipelineStatusPanel
                simulatorState={props.simulatorState}
                levelMap={props.levelMap}
                pathPrediction={props.pathPrediction}
                watches={props.watches}
                sessionContext={props.sessionContext}
                reviewedIntents={props.reviewedIntents}
                blockedEvaluations={props.blockedEvals}
                snapshot={props.snapshot}
                shadow={props.shadow}
                reliability={props.reliability}
              />
            </>
          )}

          {activeTab === 'inspector' && (
            <>
              <LevelMapPanel levelMap={props.levelMap} />
              <RoutePanel prediction={props.pathPrediction} />
              <WatchPanel watches={props.watches} />
              <NewsCalendarPanel newsContext={props.simulatorState?.newsRiskContext ?? null} />
              <SessionRegimePanel regimeContext={props.simulatorState?.regimeContext ?? null} />
            </>
          )}

          {activeTab === 'settings' && (
            <>
              {props.renderConnectionForm?.()}
              {props.renderAccountSettings?.()}
              {props.renderManualSetup?.()}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  dock: {
    borderTop: '1px solid rgba(255,255,255,0.06)',
    background: '#0d0d0f',
    display: 'flex', flexDirection: 'column',
    maxHeight: 300, minHeight: 36,
    flexShrink: 0,
  },
  dockCollapsed: {
    maxHeight: 36,
  },
  tabBar: {
    display: 'flex', alignItems: 'center', gap: 0,
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    flexShrink: 0,
  },
  tab: {
    background: 'none', border: 'none',
    color: 'rgba(255,255,255,0.3)',
    fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono, monospace)',
    letterSpacing: '0.04em',
    padding: '8px 14px', cursor: 'pointer',
    borderBottom: '2px solid transparent',
    transition: 'color 0.12s, border-color 0.12s',
  },
  tabActive: {
    color: '#60a5fa',
    borderBottomColor: '#60a5fa',
  },
  collapseBtn: {
    background: 'none', border: 'none',
    color: 'rgba(255,255,255,0.2)',
    fontSize: 10, cursor: 'pointer',
    marginLeft: 'auto', padding: '8px 12px',
  },
  tabContent: {
    flex: 1, overflowY: 'auto', padding: '8px 12px',
    display: 'flex', flexDirection: 'column', gap: 8,
  },
  ordersContent: {},
  orderTable: {
    width: '100%', borderCollapse: 'collapse', fontSize: 10,
    fontFamily: 'var(--font-mono, monospace)',
  },
  th: {
    textAlign: 'left', padding: '4px 8px',
    color: 'rgba(255,255,255,0.2)', fontSize: 9, fontWeight: 700,
    letterSpacing: '0.06em', borderBottom: '1px solid rgba(255,255,255,0.04)',
  },
  td: {
    padding: '4px 8px', color: 'rgba(255,255,255,0.5)',
    borderBottom: '1px solid rgba(255,255,255,0.02)',
  },
  emptyText: {
    fontSize: 11, color: 'rgba(255,255,255,0.2)', fontStyle: 'italic',
    padding: 12,
  },
};
