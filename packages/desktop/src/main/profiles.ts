// ── Forge Profiles ─────────────────────────────────────────────────────────────
// Domain-specific operational profiles that inject business context into every
// AI interaction, pre-load execution templates, and drive Blueprint generation.
// Profiles are TypeScript constants — type-safe, zero I/O, bundled with the app.
// The getProfile / listProfiles API is kept stable so JSON loading can be wired
// in later without touching call sites.

export interface MemoryPresetEntry {
  type: 'fact' | 'goal' | 'preference' | 'business';
  content: string;
}

export interface ExecutionTemplate {
  id: string;
  title: string;
  description: string;
  steps: string[];
}

export interface ForgeProfile {
  id: string;
  name: string;
  icon: string;
  description: string;
  /** Injected into the system prompt when active. Must stay ≤ 1200 chars. */
  systemContext: string;
  /** 10–15 domain-specific memory entries injected on activation. */
  memoryPreset: MemoryPresetEntry[];
  /** 3–5 copy-to-chat execution templates surfaced in the Profiles tab. */
  executionTemplates: ExecutionTemplate[];
  appScaffold: {
    description: string;
    modules: string[];
  };
  /** 6–10 KPI labels with target descriptions. */
  kpiModel: string[];
  /** Ordered section headings for the Blueprint document. */
  blueprintSections: string[];
  /** Full prompt sent to the AI council when generating the Operational Blueprint. */
  blueprintPrompt: string;
}

// ── Restaurant & Food Service ──────────────────────────────────────────────────

const restaurant: ForgeProfile = {
  id: 'restaurant',
  name: 'Restaurant & Food Service',
  icon: '◉',
  description: 'Food cost control, labor scheduling, menu engineering, and daily operations for restaurants and food service businesses.',

  systemContext: `Active Forge Profile: Restaurant & Food Service Operations.

Conventions for all responses:
- Labor cost target: 28–32% of revenue. Food cost target: 28–35%. Prime cost (labor + food) below 65%.
- Table turnover and average check size are the primary revenue levers.
- Menu engineering: Stars (high margin + high popularity) are the priority. Puzzles (high margin, low popularity) need promotion. Dogs (both low) should be removed.
- Cash flow is weekly — daily covers and daily revenue are more actionable than monthly totals.
- Cross-train staff to reduce scheduling dependency on single roles.
- Health code compliance, food handler permits, and allergen labeling are non-negotiable.

When reviewing finances, always calculate prime cost before drawing conclusions. When advising on hiring, frame responses in terms of shift coverage and cross-training. When building apps, prioritize table management, POS integration, and staff scheduling.`,

  memoryPreset: [
    { type: 'business',   content: 'Business type: restaurant / food service operation' },
    { type: 'business',   content: 'Primary revenue metric: covers per day × average check size' },
    { type: 'business',   content: 'Target food cost: 28–35% of revenue' },
    { type: 'business',   content: 'Target labor cost: 28–32% of revenue' },
    { type: 'business',   content: 'Prime cost target (food + labor combined): below 65% of revenue' },
    { type: 'preference', content: 'When analyzing finances, always calculate prime cost before drawing conclusions' },
    { type: 'preference', content: 'When advising on staffing, frame recommendations in terms of shift coverage and cross-training first' },
    { type: 'preference', content: 'Menu engineering: Stars = high margin + high popularity; Puzzles = high margin + low popularity; Plowhorses = low margin + high popularity; Dogs = both low' },
    { type: 'fact',       content: 'Cash flow cycle is weekly — daily covers and daily revenue are more actionable than monthly summaries' },
    { type: 'preference', content: 'When building apps for this business, prioritize table management, POS integration, and staff scheduling modules' },
    { type: 'business',   content: 'Health code compliance and allergen labeling are non-negotiable operational priorities' },
    { type: 'preference', content: 'Vendor pricing should be reviewed quarterly — track cost per unit over time, not just invoice totals' },
  ],

  executionTemplates: [
    {
      id: 'monthly-food-cost-audit',
      title: 'Monthly Food Cost Audit',
      description: 'Step-by-step process to calculate, verify, and reduce your monthly food cost percentage.',
      steps: [
        'Pull all supplier invoices for the month and total your food purchases',
        'Divide total food purchases by total revenue to calculate food cost %',
        'Compare to prior month and identify any items with >5% cost increase',
        'Review your top 10 highest-cost ingredients against current portion guides',
        'Check for waste, spoilage, or over-portioning on high-cost items',
        'Adjust order quantities for items showing consistent over-ordering',
        'Document findings and set a target food cost % for next month',
      ],
    },
    {
      id: 'staff-hiring-workflow',
      title: 'New Staff Hiring Process',
      description: 'Structured hiring workflow covering job posting, screening, working interview, and offer.',
      steps: [
        'Define the role: exact shift requirements, minimum experience, and certifications needed (e.g., food handler card)',
        'Write a concise job description: duties, hours, pay range, and one sentence on your culture',
        'Post on Indeed, Craigslist, and local Facebook groups — specify shift times in the title',
        'Screen applicants by phone: availability, reliability history, and relevant experience only',
        'Conduct a paid working interview during a live service shift — observe speed, composure, and teamwork',
        'Score candidates on: punctuality, communication, skill demonstration, and fit with existing team',
        'Extend offer in writing with exact schedule, start date, training plan, and 30-day review date',
      ],
    },
    {
      id: 'menu-profitability-review',
      title: 'Menu Profitability Review',
      description: 'Classify every menu item by margin and popularity to identify what to promote, reprice, or remove.',
      steps: [
        'Pull last 90 days of sales by menu item from your POS system',
        'Calculate food cost per item: ingredient cost ÷ menu price × 100',
        'Rank all items by gross margin (menu price minus food cost)',
        'Rank all items by units sold (popularity)',
        'Classify each item: Star (high margin + high sales), Puzzle (high margin + low sales), Plowhorse (low margin + high sales), Dog (low margin + low sales)',
        'Action plan: promote Stars, reposition Puzzles, reprice or reduce portion on Plowhorses, remove or revamp Dogs',
        'Update menu layout to feature Stars prominently; track results for 30 days',
      ],
    },
  ],

  appScaffold: {
    description: 'Operational dashboard for restaurant management covering reservations, menu costing, staff scheduling, and daily revenue tracking.',
    modules: [
      'Table management / reservation tracker',
      'Menu item catalog with ingredient cost tracking',
      'Daily revenue and covers log',
      'Staff scheduling board with shift assignments',
      'Inventory tracker with par levels and reorder alerts',
    ],
  },

  kpiModel: [
    'Daily Covers — total customers served per day, target set by seating capacity and table turnover goal',
    'Average Check Size — total revenue ÷ covers, tracked daily',
    'Food Cost % — food purchases ÷ revenue × 100, target 28–35%',
    'Labor Cost % — labor costs ÷ revenue × 100, target 28–32%',
    'Prime Cost % — (food + labor) ÷ revenue × 100, target <65%',
    'Table Turnover Rate — covers ÷ table count per service period',
    'Daily Revenue — gross revenue per day tracked against weekly targets',
    'Monthly Net Profit Margin % — net profit ÷ revenue × 100',
  ],

  blueprintSections: [
    'Executive Summary',
    'Financial Performance Framework',
    'Menu Engineering Matrix',
    'Labor & Staffing Plan',
    'Cost Control Protocols',
    'Vendor Management',
    '30-Day Action Plan',
    'Key Performance Indicators',
  ],

  blueprintPrompt: `Generate a comprehensive Operational Blueprint for a restaurant or food service business. Format in structured markdown with the following sections in order:

## Executive Summary
Operational snapshot: what the blueprint addresses and the top 3 priorities.

## Financial Performance Framework
Weekly tracking approach for: revenue per day, food cost %, labor cost %, prime cost %, average check size, covers per day. Include target ranges and what triggers a review.

## Menu Engineering Matrix
Framework for classifying menu items into Stars, Puzzles, Plowhorses, and Dogs. Include a markdown table with columns: Category | Margin | Popularity | Recommended Action.

## Labor & Staffing Plan
Staffing ratios by shift, cross-training requirements, scheduling approach, and key positions requiring backup coverage.

## Cost Control Protocols
Food waste reduction, portion control enforcement, vendor negotiation cadence, and inventory management approach.

## Vendor Management
Approach to supplier relationships: review frequency, cost benchmarking, and backup vendor strategy.

## 30-Day Action Plan
Exactly 5 specific, prioritized actions for the first 30 days, each with a clear outcome metric.

## Key Performance Indicators
Table with: KPI Name | Target Range | Measurement Frequency | Owner

Keep all recommendations specific and operational. Use tables for comparisons. Avoid generic advice.`,
};

// ── Trucking & Freight ─────────────────────────────────────────────────────────

const trucking: ForgeProfile = {
  id: 'trucking',
  name: 'Trucking & Freight',
  icon: '◈',
  description: 'Cost-per-mile analysis, dispatch optimization, driver management, DOT compliance, and fleet maintenance for trucking and freight operations.',

  systemContext: `Active Forge Profile: Trucking & Freight Operations.

Conventions for all responses:
- Cost per mile is the primary profitability metric — track fuel, maintenance, and driver pay separately.
- Deadhead miles (empty miles) should stay below 15% of total miles.
- Revenue per load and load-to-truck ratio determine dispatch efficiency.
- Driver retention is the top operational priority — replacement cost is 3–6 months of driver salary.
- DOT compliance: hours of service (HOS) logs, drug testing, and vehicle inspections are mandatory.
- Preventive maintenance schedules reduce breakdown cost significantly versus reactive repairs.
- Fuel surcharge adjustments must track diesel price indices weekly.

When reviewing operations, always ask about deadhead %, load-to-truck ratio, and PM schedule compliance. When advising on hiring, prioritize CDL class, driving record, and HOS compliance history.`,

  memoryPreset: [
    { type: 'business',   content: 'Business type: trucking / freight logistics operation' },
    { type: 'business',   content: 'Primary profitability metric: cost per mile (fuel + maintenance + driver pay tracked separately)' },
    { type: 'business',   content: 'Target deadhead percentage: below 15% of total miles' },
    { type: 'business',   content: 'Key revenue metrics: revenue per load and load-to-truck ratio' },
    { type: 'preference', content: 'Always ask about deadhead % and load-to-truck ratio before advising on dispatch operations' },
    { type: 'preference', content: 'Frame hiring advice in terms of driver retention risk and replacement cost (3–6 months salary equivalent)' },
    { type: 'business',   content: 'DOT compliance: HOS logs, drug testing, and vehicle inspections are mandatory operational requirements' },
    { type: 'preference', content: 'Fuel cost tracks diesel price index — review and adjust fuel surcharges weekly' },
    { type: 'preference', content: 'When building apps for this business, prioritize load board, driver logs, and fleet maintenance tracking' },
    { type: 'fact',       content: 'Preventive maintenance reduces breakdown costs more than reactive repairs — PM schedule compliance is a tracked KPI' },
    { type: 'business',   content: 'Owner-operators require separate accounting treatment from company drivers' },
    { type: 'preference', content: 'Evaluate loads by revenue per mile, not total load revenue — deadhead return miles factor into the calculation' },
  ],

  executionTemplates: [
    {
      id: 'load-dispatch-workflow',
      title: 'Load Planning & Dispatch',
      description: 'End-to-end workflow for selecting, assigning, and tracking loads to maximize revenue per mile.',
      steps: [
        'Review available loads by origin, destination, and pickup window — prioritize loads that backhaul from your drop destination',
        'Calculate revenue per mile for each candidate: total load rate ÷ total miles (loaded + estimated empty return)',
        'Verify driver HOS availability: confirm hours remaining and required reset time before pickup',
        'Check fuel cost estimate: total distance × current diesel price per mile for that lane',
        'Confirm equipment compatibility: trailer type, weight class, and any special certifications required',
        'Assign load to driver, log in dispatch board with pickup window and delivery deadline',
        'Set check-in protocol: driver confirms pickup, en-route update every 4 hours, delivery confirmation required',
      ],
    },
    {
      id: 'driver-onboarding',
      title: 'New Driver Onboarding',
      description: 'Compliant, structured process for bringing on a new CDL driver from application to first load.',
      steps: [
        'Verify CDL class and all required endorsements (HazMat, Tanker, Doubles/Triples as applicable to your operation)',
        'Run Motor Vehicle Record (MVR) — disqualify for DUIs, license suspensions, or more than 2 preventable accidents in 3 years',
        'Verify current DOT medical certificate — must be valid and on file before first dispatch',
        'Complete pre-employment drug test — no exceptions regardless of prior employer history',
        'Review company HOS policy, dispatch protocol, check-in requirements, and accident reporting procedure',
        'Complete vehicle pre-trip inspection training — confirm driver can perform and document the full DVIR procedure',
        'Assign first load with supervisor check-in at each stop for the first 3 runs',
      ],
    },
    {
      id: 'maintenance-cost-audit',
      title: 'Monthly Maintenance Cost Audit',
      description: 'Review fleet maintenance spend by truck to identify high-cost units and preventive maintenance gaps.',
      steps: [
        'Pull all repair and maintenance invoices for the month, categorized by truck unit number',
        'Calculate maintenance cost per mile for each truck: total spend ÷ miles driven that month',
        'Flag any truck spending more than 150% of the fleet average cost per mile',
        'Review PM schedule compliance: oil changes, tire rotations, brake inspections — identify any overdue units',
        'Identify any maintenance deferred from prior months and schedule immediately',
        'Categorize all repairs as preventive or breakdown — high breakdown cost signals PM schedule gaps',
        'Document findings and set a maintenance spend budget by unit for next month',
      ],
    },
  ],

  appScaffold: {
    description: 'Operations dashboard for a trucking company covering load dispatch, driver management, fleet maintenance, and revenue tracking.',
    modules: [
      'Load board with dispatch assignment and delivery status tracking',
      'Driver log and HOS compliance tracker',
      'Fleet maintenance log with PM schedule by truck unit',
      'Fuel cost and expense tracker by trip',
      'Revenue and cost-per-mile dashboard',
    ],
  },

  kpiModel: [
    'Cost Per Mile — total operating cost ÷ total miles driven, tracked weekly',
    'Revenue Per Load — gross load revenue tracked by load and by driver',
    'Deadhead % — empty miles ÷ total miles × 100, target <15%',
    'Driver Utilization % — revenue miles ÷ available driver capacity × 100',
    'Fuel Cost as % of Revenue — fuel spend ÷ gross revenue × 100',
    'Maintenance Cost Per Mile — total maintenance spend ÷ total miles, tracked by truck unit',
    'On-Time Delivery Rate % — loads delivered on time ÷ total loads × 100',
    'Monthly Loads Completed — total loads delivered, tracked against capacity target',
  ],

  blueprintSections: [
    'Executive Summary',
    'Operational Performance Framework',
    'Driver Management & Retention',
    'Fleet Maintenance Protocol',
    'Load & Dispatch Optimization',
    'Cost Control & Fuel Management',
    'DOT Compliance Checklist',
    '30-Day Action Plan',
    'Key Performance Indicators',
  ],

  blueprintPrompt: `Generate a comprehensive Operational Blueprint for a trucking or freight logistics business. Format in structured markdown with the following sections in order:

## Executive Summary
Operational snapshot: primary business model (OTR, regional, local), current fleet size estimate, and top 3 operational priorities.

## Operational Performance Framework
Weekly tracking approach for: cost per mile, revenue per load, deadhead %, driver utilization %, and on-time delivery rate. Include target ranges and escalation triggers.

## Driver Management & Retention
Driver onboarding requirements (CDL, MVR, DOT medical, drug test), retention strategies, pay structure options (company driver vs. owner-operator), and what triggers a corrective action review.

## Fleet Maintenance Protocol
Preventive maintenance schedule by vehicle type (oil change intervals, brake inspections, tire rotations), breakdown response protocol, and shop/vendor relationships.

## Load & Dispatch Optimization
Load selection criteria (minimum revenue per mile threshold), backhaul planning approach, deadhead reduction strategy, and dispatch communication protocol.

## Cost Control & Fuel Management
Fuel surcharge policy, fuel card program, top cost categories to monitor monthly, and expense review process.

## DOT Compliance Checklist
Required documents by driver and by vehicle, HOS policy summary, drug testing schedule, and inspection readiness checklist.

## 30-Day Action Plan
Exactly 5 specific, prioritized actions for the first 30 days, each with a clear outcome metric.

## Key Performance Indicators
Table with: KPI Name | Target | Measurement Frequency | Owner

Keep all recommendations specific and operational. Use tables where useful. Avoid generic advice.`,
};

// ── Consultant & Agency ────────────────────────────────────────────────────────

const consultant: ForgeProfile = {
  id: 'consultant',
  name: 'Consultant & Agency',
  icon: '⊞',
  description: 'Billable utilization, proposal development, client retention, invoice management, and project margin optimization for consultants and professional services firms.',

  systemContext: `Active Forge Profile: Consulting & Professional Services.

Conventions for all responses:
- Billable utilization target: 70–80% for solo practitioners, 60–75% for firms.
- No single client should exceed 30% of revenue (concentration risk).
- Scope creep is the primary profitability risk — all scope changes must be formalized as written change orders.
- Retainer clients are more valuable than project-based clients — prioritize conversion.
- Invoice terms: net-15 preferred over net-30 to optimize cash flow.
- Proposal win rate below 30% signals scope or pricing misalignment — review quarterly.
- Project margin after subcontractor costs is more accurate than top-line revenue.

When reviewing finances, always distinguish top-line revenue from realized project margin. When advising on growth, prioritize referral systems and case study development over outbound marketing.`,

  memoryPreset: [
    { type: 'business',   content: 'Business type: professional services / consulting firm' },
    { type: 'business',   content: 'Target billable utilization: 70–80% for solo practitioners, 60–75% for multi-person firms' },
    { type: 'business',   content: 'Client concentration risk: no single client should exceed 30% of total revenue' },
    { type: 'preference', content: 'Always distinguish top-line revenue from realized project margin after subcontractor costs' },
    { type: 'preference', content: 'Retainer clients are more valuable than project-based — track and prioritize retainer conversion rate' },
    { type: 'business',   content: 'Scope creep is the primary profitability risk — formalize all scope changes as written change orders before doing the work' },
    { type: 'business',   content: 'Invoice terms: net-15 preferred over net-30 to optimize cash flow' },
    { type: 'preference', content: 'Track proposal win rate quarterly — below 30% signals scope or pricing misalignment requiring review' },
    { type: 'preference', content: 'When building apps for this business, prioritize client CRM, proposal tracking, and invoice management' },
    { type: 'fact',       content: 'Referral systems and case study development produce higher ROI than outbound marketing for services businesses' },
    { type: 'business',   content: 'Project margin tracks profitability more accurately than revenue — always measure after all subcontractor costs are deducted' },
    { type: 'preference', content: 'Frame growth advice in terms of client retention and referral rate before recommending acquisition spending' },
  ],

  executionTemplates: [
    {
      id: 'client-onboarding',
      title: 'New Client Onboarding',
      description: 'Structured process for onboarding a new client from signed contract to kick-off, establishing scope, communication, and project foundations.',
      steps: [
        'Send welcome email within 24 hours of contract signature: confirm project summary, start date, and your primary point of contact',
        'Share onboarding questionnaire: key stakeholder names, existing tools and access, approval processes, and any non-negotiable constraints',
        'Schedule kick-off call within 5 business days — agenda: confirm scope, success metrics, communication cadence, and escalation path',
        'Document scope and success metrics in a one-page Project Charter — share with client for written sign-off before work begins',
        'Set up shared project folder (Google Drive, Notion, or SharePoint) with contract, SOW, timeline, and version log',
        'Establish communication cadence: weekly status email + biweekly call, or as agreed in the SOW',
        'Log client in CRM with contract value, start date, renewal date, key contacts, and any red flags noted during sales',
      ],
    },
    {
      id: 'proposal-development',
      title: 'Proposal Development Workflow',
      description: 'Disciplined process for scoping, pricing, and delivering a winning proposal that protects your project margins.',
      steps: [
        'Clarify the client problem statement in your own words and get verbal confirmation before you start scoping',
        'Define deliverables explicitly and list what is out of scope — document both in writing',
        'Estimate hours by project phase (discovery, delivery, review cycles, project management) with a 15% contingency buffer',
        'Calculate project margin: total hours × effective hourly rate, minus any subcontractor or tool costs',
        'Draft the proposal: executive summary, scope of work, deliverables, timeline, pricing, and payment terms (net-15)',
        'Walk through scope with the client verbally before sending the formal document — confirm no surprises',
        'Send formal proposal with a 5-business-day response window and schedule a follow-up at day 4',
      ],
    },
    {
      id: 'monthly-invoice-run',
      title: 'Monthly Invoice Run',
      description: 'End-of-month invoicing process to ensure all billable hours are captured, scope changes are billed, and outstanding invoices are followed up.',
      steps: [
        'Pull all time entries for the month by client and project from your time tracking tool',
        'Verify hours against each project SOW — flag any hours that fall outside agreed scope',
        'Identify any scope additions that need a change order — draft and get client approval before including in invoice',
        'Generate invoices for each client with itemized hours, rates, and any approved expense reimbursements',
        'Send invoices with clear remittance instructions: payment method, due date, and late fee policy',
        'Log all invoices in accounts receivable tracker with issue date, due date, and payment status',
        'Follow up on any invoice unpaid after 10 days with a brief, professional email',
      ],
    },
  ],

  appScaffold: {
    description: 'Client management and operations dashboard for a consulting firm covering CRM, proposals, time tracking, invoicing, and revenue reporting.',
    modules: [
      'Client CRM with project status, contract value, and renewal tracking',
      'Proposal tracker with win rate reporting',
      'Time entry and billable hours log by client and project',
      'Invoice tracker with payment status and accounts receivable aging',
      'Monthly P&L summary with utilization % and project margin reporting',
    ],
  },

  kpiModel: [
    'Billable Utilization % — billable hours ÷ available work hours × 100, target 70–80% solo / 60–75% firm',
    'Revenue Per Client — average monthly or project revenue per active client',
    'Proposal Win Rate % — proposals won ÷ proposals sent × 100, reviewed quarterly',
    'Average Project Margin % — (project revenue − subcontractor costs) ÷ project revenue × 100',
    'Monthly Recurring Revenue — total retainer and recurring project revenue, tracked monthly',
    'Client Concentration — top client revenue as % of total revenue, target <30%',
    'Accounts Receivable Days Outstanding — average days from invoice issue to payment received',
    'Referral Rate % — new clients sourced from referrals ÷ total new clients × 100',
  ],

  blueprintSections: [
    'Executive Summary',
    'Service Line Overview',
    'Client Acquisition Framework',
    'Proposal & Scoping Protocol',
    'Utilization & Capacity Management',
    'Billing & Cash Flow Optimization',
    'Growth & Retention Strategy',
    '30-Day Action Plan',
    'Key Performance Indicators',
  ],

  blueprintPrompt: `Generate a comprehensive Operational Blueprint for a consulting or professional services business. Format in structured markdown with the following sections in order:

## Executive Summary
Operational snapshot: service lines offered, current client count estimate, and top 3 priorities for the next 90 days.

## Service Line Overview
Summary of current service offerings, target client profile, and pricing model (project-based, retainer, or hourly). Identify highest-margin service lines.

## Client Acquisition Framework
Referral system design, case study development approach, proposal win rate targets, and outreach prioritization. Include a simple conversion funnel from lead to signed contract.

## Proposal & Scoping Protocol
Standard proposal structure, scope documentation requirements, pricing approach, change order process, and standard payment terms.

## Utilization & Capacity Management
Billable hour targets by role, capacity planning approach, subcontractor management, and how to identify when capacity is at risk of being exceeded or under-utilized.

## Billing & Cash Flow Optimization
Invoicing cadence, payment terms policy, late payment handling procedure, and accounts receivable management approach.

## Growth & Retention Strategy
Client retention indicators, retainer conversion approach, referral program structure, and criteria for when to expand the team or raise rates.

## 30-Day Action Plan
Exactly 5 specific, prioritized actions for the first 30 days, each with a clear outcome metric.

## Key Performance Indicators
Table with: KPI Name | Target | Measurement Frequency | Owner

Keep all recommendations specific and operational. Use tables where useful. Avoid generic advice.`,
};

// ── Registry ───────────────────────────────────────────────────────────────────

export const FORGE_PROFILES: ForgeProfile[] = [restaurant, trucking, consultant];

/** Returns a profile by id, or undefined if not found. */
export function getProfile(id: string): ForgeProfile | undefined {
  return FORGE_PROFILES.find(p => p.id === id);
}

/** Returns the full list of available profiles. */
export function listProfiles(): ForgeProfile[] {
  return FORGE_PROFILES;
}
