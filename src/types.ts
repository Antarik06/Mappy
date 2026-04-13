// ===== Mappy — Territory Conquest Game — Type Definitions =====

export type UnitType = 'infantry' | 'bike' | 'car';
export type GamePhase = 'setup' | 'playing' | 'victory' | 'defeat';
export type AIPersonality = 'aggressive' | 'defensive' | 'balanced' | 'opportunistic';
export type GameSpeed = 0 | 1 | 2 | 3; // 0=paused

export interface UnitStats {
  attack: number;
  defense: number;
  travelTicks: number; // ticks to cross one province border
  cost: number;        // resource cost per unit
  icon: string;        // unicode symbol
  label: string;
}

export const UNIT_STATS: Record<UnitType, UnitStats> = {
  infantry: { attack: 1.0, defense: 1.5, travelTicks: 2, cost: 1, icon: '●', label: 'Infantry' },
  bike:     { attack: 1.5, defense: 0.5, travelTicks: 1, cost: 2, icon: '◆', label: 'Bike' },
  car:      { attack: 3.0, defense: 2.0, travelTicks: 3, cost: 4, icon: '⬠', label: 'Car' },
};

export const TICK_BASE_MS = 3000; // base tick interval at 1x speed

export interface TroopStack {
  infantry: number;
  bike: number;
  car: number;
}

export function emptyTroops(): TroopStack {
  return { infantry: 0, bike: 0, car: 0 };
}

export function totalTroops(t: TroopStack): number {
  return t.infantry + t.bike + t.car;
}

export function attackPower(t: TroopStack): number {
  return t.infantry * UNIT_STATS.infantry.attack
       + t.bike * UNIT_STATS.bike.attack
       + t.car * UNIT_STATS.car.attack;
}

export function defensePower(t: TroopStack): number {
  return t.infantry * UNIT_STATS.infantry.defense
       + t.bike * UNIT_STATS.bike.defense
       + t.car * UNIT_STATS.car.defense;
}

export function troopValue(t: TroopStack): number {
  // Weighted value for AI evaluation
  return t.infantry * 1 + t.bike * 1.5 + t.car * 3;
}

export interface Province {
  id: string;          // ISO_A3 code
  name: string;
  ownerId: string | null;
  troops: TroopStack;
  production: UnitType;
  centroid: [number, number]; // [lat, lng] for Leaflet
  adjacentIds: string[];
  resistanceTicks: number;   // newly conquered: no troop gen
  lastCombatTick: number;
  population: number;        // for display
  area: number;              // km² for spawn calculation
  spawnPoints: number;       // troops generated per tick (large countries > 1)
  subCentroids: [number, number][]; // visual army distribution points
}

export interface Nation {
  id: string;
  name: string;
  color: string;
  isPlayer: boolean;
  personality: AIPersonality;
}

export interface TroopMovement {
  id: string;
  nationId: string;
  sourceId: string;
  targetId: string;
  troops: TroopStack;
  ticksRemaining: number;
  totalTicks: number;
  sourceCentroid: [number, number];
  targetCentroid: [number, number];
}

export interface BattleLogEntry {
  id: string;
  tick: number;
  message: string;
  type: 'capture' | 'defense' | 'loss' | 'info' | 'ai';
  nationColor?: string;
}

export interface GameState {
  phase: GamePhase;
  tick: number;
  speed: GameSpeed;
  provinces: Map<string, Province>;
  nations: Map<string, Nation>;
  movements: TroopMovement[];
  battleLog: BattleLogEntry[];
  playerId: string;
}

// ── AI Nation Config ──
export const AI_NATION_NAMES = [
  'Iron Dominion', 'Storm Empire', 'Shadow Republic',
  'Frost Federation', 'Ember Alliance', 'Thorn Collective',
  'Crimson Pact', 'Azure Kingdom', 'Obsidian Order',
  'Jade Sovereignty', 'Scarlet Legion', 'Midnight Union',
];

export const AI_COLORS = [
  '#ef4444', '#f97316', '#8b5cf6', '#ec4899',
  '#eab308', '#06b6d4', '#f43f5e', '#a855f7',
];

export const PLAYER_COLORS = [
  '#22c55e', '#3b82f6', '#14b8a6', '#6366f1',
  '#10b981', '#0ea5e9', '#8b5cf6', '#f59e0b',
];

// ── Balance Constants ──
export const RESISTANCE_TICKS = 5;       // no troop gen after capture
export const STAGNATION_THRESHOLD = 25;  // ticks without combat → penalty
export const STAGNATION_PENALTY = 0.5;   // 50% less troop gen
export const INITIAL_TROOPS = 5;         // starting troops per province
export const TROOPS_PER_TICK = 1;        // base troop generation

// GeoJSON data URL  
export const COUNTRIES_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson';
