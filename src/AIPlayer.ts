// ===== Mappy — AI Player Decision Engine =====
import {
  GameState, TroopStack, Province, AIPersonality,
  UNIT_STATS, totalTroops, attackPower, defensePower, troopValue,
} from './types';

export interface AIMove {
  sourceId: string;
  targetId: string;
  troops: TroopStack;
}

export class AIPlayer {
  nationId: string;
  personality: AIPersonality;

  constructor(nationId: string, personality: AIPersonality) {
    this.nationId = nationId;
    this.personality = personality;
  }

  decide(state: GameState): AIMove[] {
    const moves: AIMove[] = [];
    const myProvinces = [...state.provinces.values()].filter(p => p.ownerId === this.nationId);
    if (myProvinces.length === 0) return moves;

    // Classify provinces
    const borderProvinces: Province[] = [];
    const interiorProvinces: Province[] = [];

    for (const prov of myProvinces) {
      const hasEnemyNeighbor = prov.adjacentIds.some(adjId => {
        const adj = state.provinces.get(adjId);
        return adj && adj.ownerId !== this.nationId;
      });
      if (hasEnemyNeighbor) {
        borderProvinces.push(prov);
      } else {
        interiorProvinces.push(prov);
      }
    }

    // Threshold multipliers based on personality
    const attackThreshold = this.personality === 'aggressive' ? 1.1
      : this.personality === 'opportunistic' ? 1.3
      : this.personality === 'balanced' ? 1.5
      : 2.0; // defensive

    const reinforceThreshold = this.personality === 'defensive' ? 0.8
      : this.personality === 'balanced' ? 0.6
      : 0.4;

    const maxMovesPerTurn = this.personality === 'aggressive' ? 3
      : this.personality === 'opportunistic' ? 2
      : 2;

    // ── Strategy 1: Reinforce borders from interior ──
    for (const interior of interiorProvinces) {
      if (totalTroops(interior.troops) < 3) continue;
      if (moves.length >= maxMovesPerTurn) break;

      // Find weakest adjacent border province
      let weakestBorder: Province | null = null;
      let weakestVal = Infinity;

      for (const adjId of interior.adjacentIds) {
        const adj = state.provinces.get(adjId);
        if (!adj || adj.ownerId !== this.nationId) continue;
        const isBorder = adj.adjacentIds.some(a => {
          const ap = state.provinces.get(a);
          return ap && ap.ownerId !== this.nationId;
        });
        if (isBorder && troopValue(adj.troops) < weakestVal) {
          weakestVal = troopValue(adj.troops);
          weakestBorder = adj;
        }
      }

      if (weakestBorder && troopValue(weakestBorder.troops) < troopValue(interior.troops) * reinforceThreshold) {
        const sendTroops = this.computeSendAmount(interior.troops, 0.6);
        if (totalTroops(sendTroops) > 0) {
          moves.push({ sourceId: interior.id, targetId: weakestBorder.id, troops: sendTroops });
        }
      }
    }

    // ── Strategy 2: Attack weak enemy provinces ──
    // Score all possible attacks
    const attacks: { source: Province; target: Province; ratio: number }[] = [];

    for (const prov of borderProvinces) {
      if (totalTroops(prov.troops) < 4) continue;

      for (const adjId of prov.adjacentIds) {
        const adj = state.provinces.get(adjId);
        if (!adj || adj.ownerId === this.nationId) continue;

        const myPower = attackPower(prov.troops);
        const enemyPower = defensePower(adj.troops);
        const ratio = enemyPower > 0 ? myPower / enemyPower : 999;

        if (ratio >= attackThreshold) {
          attacks.push({ source: prov, target: adj, ratio });
        }
      }
    }

    // Sort by best ratio (easiest wins first)
    attacks.sort((a, b) => b.ratio - a.ratio);

    // Opportunistic personality: prefer attacking the player
    if (this.personality === 'opportunistic') {
      attacks.sort((a, b) => {
        const aIsPlayer = a.target.ownerId === 'player' ? 1 : 0;
        const bIsPlayer = b.target.ownerId === 'player' ? 1 : 0;
        if (aIsPlayer !== bIsPlayer) return bIsPlayer - aIsPlayer;
        return b.ratio - a.ratio;
      });
    }

    const usedSources = new Set(moves.map(m => m.sourceId));
    for (const atk of attacks) {
      if (moves.length >= maxMovesPerTurn) break;
      if (usedSources.has(atk.source.id)) continue;

      // Keep some troops for defense (at least 2)
      const keepRatio = this.personality === 'aggressive' ? 0.8
        : this.personality === 'defensive' ? 0.5
        : 0.65;

      const sendTroops = this.computeSendAmount(atk.source.troops, keepRatio);
      if (totalTroops(sendTroops) >= 2) {
        moves.push({ sourceId: atk.source.id, targetId: atk.target.id, troops: sendTroops });
        usedSources.add(atk.source.id);
      }
    }

    // ── Strategy 3: Claim neutral provinces ──
    if (moves.length < maxMovesPerTurn) {
      for (const prov of borderProvinces) {
        if (moves.length >= maxMovesPerTurn) break;
        if (usedSources.has(prov.id)) continue;
        if (totalTroops(prov.troops) < 3) continue;

        for (const adjId of prov.adjacentIds) {
          const adj = state.provinces.get(adjId);
          if (!adj || adj.ownerId !== null) continue;

          const sendTroops = this.computeSendAmount(prov.troops, 0.4);
          if (totalTroops(sendTroops) > 0) {
            moves.push({ sourceId: prov.id, targetId: adjId, troops: sendTroops });
            usedSources.add(prov.id);
            break;
          }
        }
      }
    }

    return moves;
  }

  private computeSendAmount(available: TroopStack, ratio: number): TroopStack {
    return {
      infantry: Math.floor(available.infantry * ratio),
      bike: Math.floor(available.bike * ratio),
      car: Math.floor(available.car * ratio),
    };
  }
}
