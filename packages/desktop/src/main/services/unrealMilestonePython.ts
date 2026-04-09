// ── unrealMilestonePython.ts ─────────────────────────────────────────────────
//
// Phase C2-lite — Companion Python scripts for Unreal milestones.
//
// The audit found that M1-M5 produce JSON manifests describing what *should*
// exist, but no actual Unreal assets. Users open Unreal expecting Blueprints
// and find folders of JSON.
//
// This module closes that gap by emitting a real Python script alongside the
// JSON spec. The script uses Unreal's built-in `unreal` Python module
// (available in Editor 5.x out of the box) to materialize the assets the JSON
// describes — folders, Blueprint assets, level setup, etc.
//
// To run: open the Unreal Editor, go to Tools → Execute Python Script,
// pick the generated TriForge/M{N}_Apply.py file, and Unreal creates the
// content for you.
//
// We deliberately keep these scripts conservative:
//   • Always idempotent — re-running is safe
//   • Always log what they do
//   • Never destructive — never delete existing assets
//   • Wrap each step in try/except so partial success is meaningful
//
// What they currently materialize:
//   M1: Folder structure + Input Actions + IMC + game mode/character/controller stubs
//   M2: Health, Survival, HUD widget folder structure + stub Blueprints
//   M3: Inventory folder structure + interaction component stubs
//   M4: Enemy/combat folder structure + AI controller stubs
//   M5: SaveGame Blueprint stub + checkpoint actor folder
//
// These are scaffolds, not finished gameplay — but they are real .uasset files
// the user can open in Unreal Editor. That's the gap the audit flagged.

import type { UnrealScaffoldResult, UnrealMilestoneResult } from '@triforge/engine';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Escape a value for embedding inside a Python single-quoted string. */
function pyStr(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** Common preamble: idempotent helpers used by every milestone script. */
function pythonPreamble(milestone: string, projectName: string, generatedAt: string): string {
  return `# ${'='.repeat(72)}
# TriForge ${milestone} — Apply Script
# Project: ${projectName}
# Generated: ${generatedAt}
#
# Run from Unreal Editor:
#   1. Open this project in Unreal Editor.
#   2. Go to Tools -> Execute Python Script.
#   3. Pick this file (TriForge/${milestone}_Apply.py).
#   4. Watch the Output Log for progress.
#
# This script is idempotent — re-running is safe. It will not overwrite or
# delete any assets you have created or modified.
# ${'='.repeat(72)}

import unreal

asset_tools  = unreal.AssetToolsHelpers.get_asset_tools()
asset_lib    = unreal.EditorAssetLibrary
level_lib    = unreal.EditorLevelLibrary

def log(msg):
    unreal.log('[TriForge ${milestone}] ' + msg)

def warn(msg):
    unreal.log_warning('[TriForge ${milestone}] ' + msg)

def err(msg):
    unreal.log_error('[TriForge ${milestone}] ' + msg)

def ensure_dir(path):
    """Create a content folder if it does not already exist."""
    if not asset_lib.does_directory_exist(path):
        asset_lib.make_directory(path)
        log('Created folder: ' + path)
    else:
        log('Folder exists: ' + path)

def ensure_blueprint(path, name, parent_class):
    """Create a Blueprint asset if missing. Returns the asset object or None."""
    full = path + '/' + name
    if asset_lib.does_asset_exist(full):
        log('Blueprint exists: ' + full)
        return asset_lib.load_asset(full)
    try:
        factory = unreal.BlueprintFactory()
        factory.set_editor_property('parent_class', parent_class)
        bp = asset_tools.create_asset(name, path, unreal.Blueprint, factory)
        if bp:
            asset_lib.save_asset(full)
            log('Created Blueprint: ' + full)
        return bp
    except Exception as e:
        err('Failed to create Blueprint ' + full + ': ' + str(e))
        return None

`;
}

// ── Camera helper (mirrors apply*.ts logic) ──────────────────────────────────

function cameraLabel(scaffoldItems: UnrealScaffoldResult['scaffoldItems']): string {
  const camItem = scaffoldItems.find(i => i.category === 'camera');
  if (!camItem) return 'Third-Person';
  if (/first.person|1st.person|fps/i.test(camItem.name)) return 'First-Person';
  if (/top.down|isometric/i.test(camItem.name)) return 'Top-Down';
  return 'Third-Person';
}

// ── M1 ───────────────────────────────────────────────────────────────────────

export function buildMilestone1PythonScript(
  projectName: string,
  scaffold:    UnrealScaffoldResult,
  _milestone:  UnrealMilestoneResult,
  generatedAt: string,
): string {
  const cam       = cameraLabel(scaffold.scaffoldItems);
  const hasInv    = scaffold.scaffoldItems.some(i => i.category === 'inventory');
  const hasSurv   = scaffold.scaffoldItems.some(i => i.category === 'survival');

  const inputActions = [
    { name: 'IA_Move',    desc: 'WASD / left stick movement' },
    { name: 'IA_Look',    desc: 'Mouse / right stick look' },
    { name: 'IA_Jump',    desc: 'Spacebar / face button south' },
    { name: 'IA_Interact',desc: 'E key / face button east' },
    ...(hasInv ? [{ name: 'IA_OpenInventory', desc: 'I key / menu button' }] : []),
  ];

  const inputActionLines = inputActions
    .map(a => `    ('${a.name}', ${pyStr(a.desc)}),`)
    .join('\n');

  return pythonPreamble('M1', projectName, generatedAt) + `
# ── M1: Foundation Setup ──────────────────────────────────────────────────────

log('Camera mode: ${cam}')
log('Inventory enabled: ${hasInv ? 'yes' : 'no'}')
log('Survival enabled:  ${hasSurv ? 'yes' : 'no'}')

# 1. Folder structure
for folder in [
    '/Game/Core',
    '/Game/Player',
    '/Game/Input',
    '/Game/Input/Actions',
    '/Game/Maps',
]:
    ensure_dir(folder)

# 2. Game Mode + Game State
ensure_blueprint('/Game/Core', 'BP_GameMode',   unreal.GameModeBase)
ensure_blueprint('/Game/Core', 'BP_GameState',  unreal.GameStateBase)

# 3. Player Character + Player Controller
ensure_blueprint('/Game/Player', 'BP_PlayerCharacter', unreal.Character)
ensure_blueprint('/Game/Player', 'BP_PlayerController', unreal.PlayerController)

# 4. Input Actions
input_actions = [
${inputActionLines}
]

for action_name, desc in input_actions:
    full = '/Game/Input/Actions/' + action_name
    if asset_lib.does_asset_exist(full):
        log('Input Action exists: ' + full)
        continue
    try:
        factory = unreal.InputActionFactory()
        ia = asset_tools.create_asset(action_name, '/Game/Input/Actions', unreal.InputAction, factory)
        if ia:
            asset_lib.save_asset(full)
            log('Created Input Action: ' + full + ' (' + desc + ')')
    except Exception as e:
        warn('InputAction creation failed for ' + action_name + ' — fall back to manual creation. ' + str(e))

# 5. Input Mapping Context
imc_path = '/Game/Input/IMC_Default'
if not asset_lib.does_asset_exist(imc_path):
    try:
        factory = unreal.InputMappingContextFactory()
        imc = asset_tools.create_asset('IMC_Default', '/Game/Input', unreal.InputMappingContext, factory)
        if imc:
            asset_lib.save_asset(imc_path)
            log('Created IMC: ' + imc_path)
    except Exception as e:
        warn('IMC creation failed — bind your IAs to a manually-created IMC instead. ' + str(e))
else:
    log('IMC exists: ' + imc_path)

log('M1 Apply complete. Open BP_PlayerCharacter and add an Enhanced Input component, ' +
    'then bind the IAs in BP_PlayerController BeginPlay via AddMappingContext(IMC_Default).')
`;
}

// ── M2 ───────────────────────────────────────────────────────────────────────

export function buildMilestone2PythonScript(
  projectName: string,
  scaffold:    UnrealScaffoldResult,
  _milestone:  UnrealMilestoneResult,
  generatedAt: string,
): string {
  const hasSurv = scaffold.scaffoldItems.some(i => i.category === 'survival');

  return pythonPreamble('M2', projectName, generatedAt) + `
# ── M2: Primary Loop, Health, HUD ─────────────────────────────────────────────

log('Survival systems: ${hasSurv ? 'yes' : 'no'}')

# 1. Folders
for folder in [
    '/Game/Health',
    '/Game/UI',
    '/Game/UI/HUD',
${hasSurv ? "    '/Game/Survival'," : ''}
]:
    ensure_dir(folder)

# 2. Health Component (ActorComponent stub)
ensure_blueprint('/Game/Health', 'BP_HealthComponent', unreal.ActorComponent)

# 3. HUD Widget stub (UMG)
hud_path = '/Game/UI/HUD/WBP_HUD'
if not asset_lib.does_asset_exist(hud_path):
    try:
        factory = unreal.WidgetBlueprintFactory()
        factory.set_editor_property('parent_class', unreal.UserWidget)
        wbp = asset_tools.create_asset('WBP_HUD', '/Game/UI/HUD', unreal.WidgetBlueprint, factory)
        if wbp:
            asset_lib.save_asset(hud_path)
            log('Created HUD Widget: ' + hud_path)
    except Exception as e:
        warn('HUD widget creation failed: ' + str(e))
else:
    log('HUD widget exists: ' + hud_path)

${hasSurv ? `
# 4. Survival components
ensure_blueprint('/Game/Survival', 'BP_HungerComponent', unreal.ActorComponent)
ensure_blueprint('/Game/Survival', 'BP_StaminaComponent', unreal.ActorComponent)
` : ''}
log('M2 Apply complete. Wire BP_HealthComponent into BP_PlayerCharacter and bind WBP_HUD ' +
    'in BP_PlayerController BeginPlay via Create Widget + Add to Viewport.')
`;
}

// ── M3 ───────────────────────────────────────────────────────────────────────

export function buildMilestone3PythonScript(
  projectName: string,
  scaffold:    UnrealScaffoldResult,
  _milestone:  UnrealMilestoneResult,
  generatedAt: string,
): string {
  const hasInv = scaffold.scaffoldItems.some(i => i.category === 'inventory');

  return pythonPreamble('M3', projectName, generatedAt) + `
# ── M3: Supporting Systems (Inventory + Interaction) ─────────────────────────

# 1. Folders
for folder in [
    '/Game/Interaction',
${hasInv ? "    '/Game/Inventory'," : ''}
${hasInv ? "    '/Game/Inventory/Items'," : ''}
]:
    ensure_dir(folder)

# 2. Interaction component stub
ensure_blueprint('/Game/Interaction', 'BP_InteractionComponent', unreal.ActorComponent)

# 3. Interactable interface — created as a Blueprint Function Library stub
#    (Real Blueprint Interfaces require a different factory; we leave the
#    proper interface creation to the user and ship the placeholder.)
ensure_blueprint('/Game/Interaction', 'BP_InteractableBase', unreal.Actor)

${hasInv ? `
# 4. Inventory component + base item
ensure_blueprint('/Game/Inventory', 'BP_InventoryComponent', unreal.ActorComponent)
ensure_blueprint('/Game/Inventory/Items', 'BP_ItemBase', unreal.Actor)
` : ''}
log('M3 Apply complete. Add BP_InteractionComponent to BP_PlayerCharacter and ' +
    'override the interaction trace logic in BP_InteractionComponent EventTick.')
`;
}

// ── M4 ───────────────────────────────────────────────────────────────────────

export function buildMilestone4PythonScript(
  projectName: string,
  scaffold:    UnrealScaffoldResult,
  _milestone:  UnrealMilestoneResult,
  generatedAt: string,
): string {
  const hasEnemy = scaffold.scaffoldItems.some(i => i.category === 'enemy');

  return pythonPreamble('M4', projectName, generatedAt) + `
# ── M4: Enemy / Combat Systems ───────────────────────────────────────────────

log('Enemy systems requested: ${hasEnemy ? 'yes' : 'no'}')

# 1. Folders
for folder in [
    '/Game/AI',
    '/Game/AI/Controllers',
    '/Game/Enemies',
    '/Game/Combat',
]:
    ensure_dir(folder)

# 2. Enemy character + AI controller stubs
ensure_blueprint('/Game/Enemies', 'BP_EnemyBase', unreal.Character)
ensure_blueprint('/Game/AI/Controllers', 'BP_EnemyAIController', unreal.AIController)

# 3. Damage dealer / damageable component stubs
ensure_blueprint('/Game/Combat', 'BP_DamageComponent', unreal.ActorComponent)

log('M4 Apply complete. Set BP_EnemyAIController as the AI Controller Class on ' +
    'BP_EnemyBase, then add a NavMesh Bounds Volume to your test arena for pathing.')
`;
}

// ── M5 ───────────────────────────────────────────────────────────────────────

export function buildMilestone5PythonScript(
  projectName: string,
  scaffold:    UnrealScaffoldResult,
  _milestone:  UnrealMilestoneResult,
  generatedAt: string,
): string {
  void scaffold;
  return pythonPreamble('M5', projectName, generatedAt) + `
# ── M5: Progression / Save System ────────────────────────────────────────────

# 1. Folders
for folder in [
    '/Game/Save',
    '/Game/Progression',
    '/Game/Checkpoints',
]:
    ensure_dir(folder)

# 2. SaveGame Blueprint
ensure_blueprint('/Game/Save', 'BP_SaveGame', unreal.SaveGame)

# 3. Checkpoint actor stub
ensure_blueprint('/Game/Checkpoints', 'BP_Checkpoint', unreal.Actor)

# 4. XP/Progression component
ensure_blueprint('/Game/Progression', 'BP_ProgressionComponent', unreal.ActorComponent)

log('M5 Apply complete. In BP_GameMode, override SaveGameToSlot/LoadGameFromSlot to ' +
    'persist the BP_SaveGame data on level transition or player death.')
`;
}
