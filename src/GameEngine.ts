// ===== Mappy — Real-Time Game Engine =====
import {
  GameState, GamePhase, Province, Nation, TroopMovement, TroopStack, BattleLogEntry,
  UnitType, AIPersonality, GameSpeed,
  UNIT_STATS, TICK_BASE_MS, COUNTRIES_URL,
  emptyTroops, totalTroops, attackPower, defensePower,
  RESISTANCE_TICKS, STAGNATION_THRESHOLD, STAGNATION_PENALTY,
  INITIAL_TROOPS, TROOPS_PER_TICK,
  AI_NATION_NAMES, AI_COLORS,
} from './types';
import { AIPlayer } from './AIPlayer';

const turf = (window as any).turf;

// ── Helpers ──
function getISO(feature: any): string {
  return feature.properties.ISO_A3 && feature.properties.ISO_A3 !== '-99'
    ? feature.properties.ISO_A3
    : (feature.properties.ADM0_A3 || feature.properties.SOV_A3 || 'UNK');
}

function getName(feature: any): string {
  return feature.properties.NAME || feature.properties.ADMIN || getISO(feature);
}

function getCentroid(feature: any): [number, number] {
  try {
    const c = turf.centroid(feature).geometry.coordinates;
    return [c[1], c[0]]; // [lat, lng] for Leaflet
  } catch {
    // Fallback: bbox center
    const bbox = turf.bbox(feature);
    return [(bbox[1] + bbox[3]) / 2, (bbox[0] + bbox[2]) / 2];
  }
}

// Generate scattered sub-centroids for large countries
function generateSubCentroids(feature: any, count: number, main: [number, number]): [number, number][] {
  if (count <= 1) return [main];
  const points: [number, number][] = [main];
  let bbox;
  try { bbox = turf.bbox(feature); } catch { return [main]; }
  
  // Try generating points inside feature
  let attempts = 0;
  while(points.length < count && attempts < 150) {
    attempts++;
    // random point in bbox
    const lng = bbox[0] + Math.random() * (bbox[2] - bbox[0]);
    const lat = bbox[1] + Math.random() * (bbox[3] - bbox[1]);
    const pt = turf.point([lng, lat]);
    
    try {
      if (turf.booleanPointInPolygon(pt, feature)) {
        // Ensure distance from existing points (rough ~1.5 degree buffer)
        let tooClose = false;
        for (const p of points) {
          if (Math.abs(p[0] - lat) < 1.5 && Math.abs(p[1] - lng) < 1.5) tooClose = true;
        }
        if (!tooClose || attempts > 100) {
           points.push([lat, lng]);
        }
      }
    } catch { /* skip errs */ }
  }
  // Fill remainder if failed to find enough distinct points
  while (points.length < count) points.push(main);
  return points;
}

let logIdCounter = 0;
function logId(): string {
  return `log-${Date.now()}-${logIdCounter++}`;
}

let movIdCounter = 0;
function movId(): string {
  return `mov-${Date.now()}-${movIdCounter++}`;
}

// ── Adjacency Computation ──
function computeAdjacency(features: any[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  const bboxes = features.map(f => {
    try { return turf.bbox(f); } catch { return [-180, -90, 180, 90]; }
  });
  const isos = features.map(f => getISO(f));

  // First pass: geometry intersection (land borders)
  for (let i = 0; i < features.length; i++) {
    const neighbors: string[] = [];
    const [w1, s1, e1, n1] = bboxes[i];

    for (let j = 0; j < features.length; j++) {
      if (i === j) continue;
      const [w2, s2, e2, n2] = bboxes[j];

      // Quick bbox rejection (with small buffer for touching edges)
      const buf = 0.5; // degrees
      if (w1 - buf > e2 || w2 - buf > e1 || s1 - buf > n2 || s2 - buf > n1) continue;

      try {
        if (turf.booleanIntersects(features[i], features[j])) {
          neighbors.push(isos[j]);
        }
      } catch { /* skip problematic geometries */ }
    }
    adj.set(isos[i], neighbors);
  }

  // Second pass: ensure connectivity for island nations
  const centroids = features.map(f => getCentroid(f));
  for (let i = 0; i < features.length; i++) {
    const iso = isos[i];
    const neighbors = adj.get(iso) || [];
    if (neighbors.length < 2) {
      // Find nearest by great-circle distance
      const distances: { iso: string; dist: number }[] = [];
      for (let j = 0; j < features.length; j++) {
        if (i === j || neighbors.includes(isos[j])) continue;
        const d = turf.distance(
          turf.point([centroids[i][1], centroids[i][0]]),
          turf.point([centroids[j][1], centroids[j][0]]),
          { units: 'kilometers' }
        );
        distances.push({ iso: isos[j], dist: d });
      }
      distances.sort((a, b) => a.dist - b.dist);
      // Add up to 3 nearest as sea routes
      for (const d of distances.slice(0, Math.max(0, 3 - neighbors.length))) {
        neighbors.push(d.iso);
        // Bidirectional
        const rev = adj.get(d.iso);
        if (rev && !rev.includes(iso)) rev.push(iso);
      }
      adj.set(iso, neighbors);
    }
  }

  return adj;
}

// ── AI Nation Generation ──
function generateAINations(
  provinces: Map<string, Province>,
  playerProvinceIds: Set<string>,
): Nation[] {
  const unclaimed = [...provinces.keys()].filter(id => !playerProvinceIds.has(id));
  if (unclaimed.length === 0) return [];

  const numAI = Math.max(2, Math.min(5, Math.ceil(unclaimed.length / 35)));
  const shuffled = [...AI_NATION_NAMES].sort(() => Math.random() - 0.5);
  const personalities: AIPersonality[] = ['aggressive', 'defensive', 'balanced', 'opportunistic'];
  const nations: Nation[] = [];

  for (let i = 0; i < numAI; i++) {
    nations.push({
      id: `ai-${i}`,
      name: shuffled[i % shuffled.length],
      color: AI_COLORS[i % AI_COLORS.length],
      isPlayer: false,
      personality: personalities[i % personalities.length],
    });
  }

  // Seed selection: pick provinces that are far apart
  const seeds: string[] = [];
  const unclaimedSet = new Set(unclaimed);
  // First seed: random
  const firstSeed = unclaimed[Math.floor(Math.random() * unclaimed.length)];
  seeds.push(firstSeed);

  for (let i = 1; i < numAI; i++) {
    let bestId = '';
    let bestMinDist = -1;
    for (const id of unclaimedSet) {
      if (seeds.includes(id)) continue;
      const prov = provinces.get(id)!;
      let minDist = Infinity;
      for (const seedId of seeds) {
        const seedProv = provinces.get(seedId)!;
        const d = Math.sqrt(
          Math.pow(prov.centroid[0] - seedProv.centroid[0], 2) +
          Math.pow(prov.centroid[1] - seedProv.centroid[1], 2)
        );
        minDist = Math.min(minDist, d);
      }
      if (minDist > bestMinDist) {
        bestMinDist = minDist;
        bestId = id;
      }
    }
    if (bestId) seeds.push(bestId);
  }

  // Flood fill from seeds
  const assigned = new Map<string, number>(); // province id → AI index
  const queues: string[][] = seeds.map((s, i) => {
    assigned.set(s, i);
    return [s];
  });

  let safety = 0;
  while (assigned.size < unclaimed.length && safety++ < 10000) {
    for (let i = 0; i < numAI; i++) {
      if (queues[i].length === 0) continue;
      const current = queues[i].shift()!;
      const prov = provinces.get(current);
      if (!prov) continue;

      for (const adjId of prov.adjacentIds) {
        if (assigned.has(adjId) || playerProvinceIds.has(adjId)) continue;
        if (!unclaimedSet.has(adjId)) continue;
        assigned.set(adjId, i);
        queues[i].push(adjId);
      }
    }
  }

  // Assign any remaining unassigned (disconnected) provinces
  for (const id of unclaimed) {
    if (!assigned.has(id)) {
      const aiIdx = Math.floor(Math.random() * numAI);
      assigned.set(id, aiIdx);
    }
  }

  // Apply ownership
  for (const [provId, aiIdx] of assigned) {
    const prov = provinces.get(provId);
    if (prov) {
      prov.ownerId = nations[aiIdx].id;
      prov.troops = { infantry: INITIAL_TROOPS, bike: 0, car: 0 };
    }
  }

  return nations;
}

// ══════════════════════════════════════════
//  GameEngine Class
// ══════════════════════════════════════════
export class GameEngine {
  state: GameState;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private onStateChange: (state: GameState) => void;
  private aiPlayers: Map<string, AIPlayer> = new Map();
  private aiTickCounter = 0;
  private geoFeatures: any[] = [];

  constructor(onStateChange: (state: GameState) => void) {
    this.onStateChange = onStateChange;
    this.state = {
      phase: 'setup',
      tick: 0,
      speed: 1,
      provinces: new Map(),
      nations: new Map(),
      movements: [],
      battleLog: [],
      playerId: 'player',
    };
  }

  // ── Load GeoJSON & Initialize Provinces ──
  async loadGeoData(): Promise<any> {
    const res = await fetch(COUNTRIES_URL);
    const data = await res.json();
    this.geoFeatures = data.features;

    // Compute adjacency
    const adjacency = computeAdjacency(this.geoFeatures);

    // Create provinces with area calculation
    const areas: number[] = [];
    const provFeatures: { id: string; feature: any; area: number }[] = [];

    for (const feature of this.geoFeatures) {
      const id = getISO(feature);
      if (id === 'UNK' || id === 'ATA') continue;
      let areaKm2 = 0;
      try { areaKm2 = turf.area(feature) / 1e6; } catch {}
      areas.push(areaKm2);
      provFeatures.push({ id, feature, area: areaKm2 });
    }

    // Calculate median area for spawn point scaling
    const sortedAreas = [...areas].sort((a, b) => a - b);
    const medianArea = sortedAreas[Math.floor(sortedAreas.length / 2)] || 500000;

    for (const { id, feature, area } of provFeatures) {
      // Spawn points: large countries generate more troops
      // 1 = small, 2 = medium-large, 3 = large, 4-5 = huge (Russia, Canada, USA, China)
      const spawnPoints = Math.max(1, Math.min(5, Math.round(area / medianArea)));
      const center = getCentroid(feature);
      const subCentroids = generateSubCentroids(feature, Math.min(spawnPoints, 4), center); // max 4 circles visually

      const prov: Province = {
        id,
        name: getName(feature),
        ownerId: null,
        troops: emptyTroops(),
        production: 'infantry',
        centroid: center,
        adjacentIds: adjacency.get(id) || [],
        resistanceTicks: 0,
        lastCombatTick: 0,
        population: feature.properties.POP_EST || 0,
        area,
        spawnPoints,
        subCentroids,
      };
      this.state.provinces.set(id, prov);
    }

    // Filter out Antarctica from adjacency lists
    for (const [, prov] of this.state.provinces) {
      prov.adjacentIds = prov.adjacentIds.filter(id => this.state.provinces.has(id));
    }

    return data;
  }

  getGeoFeatures(): any[] {
    return this.geoFeatures;
  }

  // ── Setup: Player claims provinces ──
  setPlayerNation(name: string, color: string, provinceIds: Set<string>) {
    const playerNation: Nation = {
      id: 'player',
      name: name || 'Your Nation',
      color,
      isPlayer: true,
      personality: 'balanced',
    };
    this.state.nations.set('player', playerNation);
    this.state.playerId = 'player';

    for (const id of provinceIds) {
      const prov = this.state.provinces.get(id);
      if (prov) {
        prov.ownerId = 'player';
        prov.troops = { infantry: INITIAL_TROOPS, bike: 0, car: 0 };
      }
    }
  }

  // ── Start the game ──
  startGame() {
    // Generate AI nations
    const playerIds = new Set(
      [...this.state.provinces.entries()]
        .filter(([, p]) => p.ownerId === 'player')
        .map(([id]) => id)
    );

    const aiNations = generateAINations(this.state.provinces, playerIds);
    for (const nation of aiNations) {
      this.state.nations.set(nation.id, nation);
    }

    // Create AI players
    for (const nation of aiNations) {
      this.aiPlayers.set(nation.id, new AIPlayer(nation.id, nation.personality));
    }

    this.state.phase = 'playing';
    this.state.tick = 0;
    this.addLog('⚔️ The conquest begins! Defend your borders and expand your empire.', 'info');
    this.pushState();
    this.startTicking();
  }

  // ── Tick Management ──
  private startTicking() {
    this.stopTicking();
    if (this.state.speed === 0) return;
    const ms = TICK_BASE_MS / this.state.speed;
    this.tickTimer = setInterval(() => this.tick(), ms);
  }

  private stopTicking() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  setSpeed(speed: GameSpeed) {
    this.state.speed = speed;
    if (this.state.phase === 'playing') {
      this.startTicking();
    }
    this.pushState();
  }

  stop() {
    this.stopTicking();
  }

  // ── Main Tick ──
  private tick() {
    if (this.state.phase !== 'playing') return;

    this.state.tick++;
    this.generateTroops();
    this.processMovements();
    this.aiTick();
    this.checkWinLose();
    this.pushState();
  }

  // ── Troop Generation ──
  private generateTroops() {
    for (const [, prov] of this.state.provinces) {
      if (!prov.ownerId) continue;

      // Resistance: newly captured provinces don't generate
      if (prov.resistanceTicks > 0) {
        prov.resistanceTicks--;
        continue;
      }

      // Stagnation penalty
      const ticksSinceCombat = this.state.tick - prov.lastCombatTick;
      const stagnation = ticksSinceCombat > STAGNATION_THRESHOLD ? STAGNATION_PENALTY : 1;

      // Use spawnPoints — large countries generate more troops
      const amount = Math.max(0, Math.floor(prov.spawnPoints * TROOPS_PER_TICK * stagnation));
      if (amount > 0) {
        prov.troops[prov.production] += amount;
      }
    }
  }

  // ── Movement Processing ──
  private processMovements() {
    const toRemove: number[] = [];

    for (let i = 0; i < this.state.movements.length; i++) {
      const mov = this.state.movements[i];
      mov.ticksRemaining--;

      if (mov.ticksRemaining <= 0) {
        this.resolveArrival(mov);
        toRemove.push(i);
      }
    }

    // Remove resolved (reverse order)
    for (let i = toRemove.length - 1; i >= 0; i--) {
      this.state.movements.splice(toRemove[i], 1);
    }
  }

  private resolveArrival(mov: TroopMovement) {
    const target = this.state.provinces.get(mov.targetId);
    if (!target) return;

    // Check if source nation still exists
    const nation = this.state.nations.get(mov.nationId);
    if (!nation) return;

    if (target.ownerId === mov.nationId) {
      // Friendly: merge troops
      target.troops.infantry += mov.troops.infantry;
      target.troops.bike += mov.troops.bike;
      target.troops.car += mov.troops.car;
    } else {
      // Combat!
      this.resolveCombat(mov, target);
    }
  }

  // ── Combat Resolution ──
  private resolveCombat(mov: TroopMovement, target: Province) {
    const atkPow = attackPower(mov.troops);
    const defPow = defensePower(target.troops);

    target.lastCombatTick = this.state.tick;

    const attackerName = this.state.nations.get(mov.nationId)?.name || 'Unknown';
    const defenderName = target.ownerId
      ? (this.state.nations.get(target.ownerId)?.name || 'Unknown')
      : 'Neutral';
    const attackerColor = this.state.nations.get(mov.nationId)?.color;

    if (atkPow > defPow && defPow > 0) {
      // Attacker wins
      const ratio = defPow / atkPow;
      const lossRatio = ratio * 0.8;

      const oldOwner = target.ownerId;
      target.ownerId = mov.nationId;
      target.troops = {
        infantry: Math.max(0, Math.ceil(mov.troops.infantry * (1 - lossRatio))),
        bike: Math.max(0, Math.ceil(mov.troops.bike * (1 - lossRatio))),
        car: Math.max(0, Math.ceil(mov.troops.car * (1 - lossRatio))),
      };
      target.resistanceTicks = RESISTANCE_TICKS;
      target.production = 'infantry';

      const logType = mov.nationId === 'player' ? 'capture'
        : oldOwner === 'player' ? 'loss' : 'ai';
      this.addLog(
        `⚔️ ${attackerName} captured ${target.name} from ${defenderName}!`,
        logType,
        attackerColor
      );
    } else if (atkPow > 0 && defPow === 0) {
      // Undefended capture
      target.ownerId = mov.nationId;
      target.troops = { ...mov.troops };
      target.resistanceTicks = RESISTANCE_TICKS;
      target.production = 'infantry';

      const logType = mov.nationId === 'player' ? 'capture' : 'ai';
      this.addLog(
        `🏴 ${attackerName} claimed ${target.name}!`,
        logType,
        attackerColor
      );
    } else {
      // Defender wins
      const ratio = atkPow / Math.max(defPow, 0.1);
      const lossRatio = ratio * 0.8;

      target.troops = {
        infantry: Math.max(1, Math.ceil(target.troops.infantry * (1 - lossRatio))),
        bike: Math.max(0, Math.ceil(target.troops.bike * (1 - lossRatio))),
        car: Math.max(0, Math.ceil(target.troops.car * (1 - lossRatio))),
      };

      const logType = target.ownerId === 'player' ? 'defense'
        : mov.nationId === 'player' ? 'loss' : 'ai';
      this.addLog(
        `🛡️ ${defenderName} repelled ${attackerName}'s attack on ${target.name}!`,
        logType,
        attackerColor
      );
    }
  }

  // ── AI Tick ──
  private aiTick() {
    this.aiTickCounter++;
    // AI acts every 2 ticks to give player a slight speed advantage
    if (this.aiTickCounter % 2 !== 0) return;

    for (const [nationId, aiPlayer] of this.aiPlayers) {
      // Check if this AI still has provinces
      const hasProvinces = [...this.state.provinces.values()].some(p => p.ownerId === nationId);
      if (!hasProvinces) continue;

      const moves = aiPlayer.decide(this.state);
      for (const move of moves) {
        this.sendTroops(move.sourceId, move.targetId, move.troops, nationId);
      }
    }
  }

  // ── Player/AI Actions ──
  sendTroops(sourceId: string, targetId: string, troops: TroopStack, nationId?: string): boolean {
    const source = this.state.provinces.get(sourceId);
    if (!source) return false;

    const ownerId = nationId || 'player';
    if (source.ownerId !== ownerId) return false;

    // Validate troop counts
    if (troops.infantry > source.troops.infantry ||
        troops.bike > source.troops.bike ||
        troops.car > source.troops.car) return false;

    if (totalTroops(troops) === 0) return false;

    // Check adjacency
    if (!source.adjacentIds.includes(targetId)) return false;

    // Deduct from source
    source.troops.infantry -= troops.infantry;
    source.troops.bike -= troops.bike;
    source.troops.car -= troops.car;

    // Travel time = slowest unit in the group
    let maxTicks = 0;
    if (troops.infantry > 0) maxTicks = Math.max(maxTicks, UNIT_STATS.infantry.travelTicks);
    if (troops.bike > 0) maxTicks = Math.max(maxTicks, UNIT_STATS.bike.travelTicks);
    if (troops.car > 0) maxTicks = Math.max(maxTicks, UNIT_STATS.car.travelTicks);

    const target = this.state.provinces.get(targetId);
    if (!target) return false;

    this.state.movements.push({
      id: movId(),
      nationId: ownerId,
      sourceId,
      targetId,
      troops,
      ticksRemaining: maxTicks,
      totalTicks: maxTicks,
      sourceCentroid: source.centroid,
      targetCentroid: target.centroid,
    });

    this.pushState();
    return true;
  }

  // Send a percentage of troops (for drag-to-attack)
  sendPercent(sourceId: string, targetId: string, percent: number, nationId?: string): boolean {
    const source = this.state.provinces.get(sourceId);
    if (!source) return false;
    const troops: TroopStack = {
      infantry: Math.floor(source.troops.infantry * percent),
      bike: Math.floor(source.troops.bike * percent),
      car: Math.floor(source.troops.car * percent),
    };
    return this.sendTroops(sourceId, targetId, troops, nationId);
  }

  setProduction(provinceId: string, unit: UnitType) {
    const prov = this.state.provinces.get(provinceId);
    if (prov && prov.ownerId === 'player') {
      prov.production = unit;
      this.pushState();
    }
  }

  // ── Win/Lose Check ──
  private checkWinLose() {
    const playerProvinces = [...this.state.provinces.values()].filter(p => p.ownerId === 'player');
    const playerMovements = this.state.movements.filter(m => m.nationId === 'player');

    if (playerProvinces.length === 0 && playerMovements.length === 0) {
      this.state.phase = 'defeat';
      this.stopTicking();
      this.addLog('💀 Your nation has fallen. Game Over.', 'loss');
      return;
    }

    // Check if all AI are eliminated
    const aiNationIds = [...this.state.nations.values()]
      .filter(n => !n.isPlayer)
      .map(n => n.id);

    const anyAiAlive = aiNationIds.some(aiId => {
      const hasProvince = [...this.state.provinces.values()].some(p => p.ownerId === aiId);
      const hasMovement = this.state.movements.some(m => m.nationId === aiId);
      return hasProvince || hasMovement;
    });

    if (!anyAiAlive) {
      this.state.phase = 'victory';
      this.stopTicking();
      this.addLog('🏆 You have conquered the world! Victory!', 'capture');
    }
  }

  // ── Utility ──
  private addLog(message: string, type: BattleLogEntry['type'], nationColor?: string) {
    this.state.battleLog.unshift({
      id: logId(),
      tick: this.state.tick,
      message,
      type,
      nationColor,
    });
    // Keep only last 50 entries
    if (this.state.battleLog.length > 50) {
      this.state.battleLog.length = 50;
    }
  }

  getNationStats(nationId: string) {
    const provinces = [...this.state.provinces.values()].filter(p => p.ownerId === nationId);
    let totalInf = 0, totalBike = 0, totalCar = 0;
    for (const p of provinces) {
      totalInf += p.troops.infantry;
      totalBike += p.troops.bike;
      totalCar += p.troops.car;
    }
    return {
      provinceCount: provinces.length,
      infantry: totalInf,
      bike: totalBike,
      car: totalCar,
      total: totalInf + totalBike + totalCar,
    };
  }

  private pushState() {
    // Push a shallow copy so React detects change
    this.onStateChange({ ...this.state });
  }
}
