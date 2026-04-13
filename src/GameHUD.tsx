// ===== Mappy — In-Game HUD (Drag-to-Attack + Visual Armies) =====
import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  GameState, Province, UnitType, GameSpeed,
  UNIT_STATS, totalTroops,
} from './types';
import { GameEngine } from './GameEngine';

const L = (window as any).L;
const turf = (window as any).turf;

interface GameHUDProps {
  mapInstance: React.MutableRefObject<any>;
  gameState: GameState;
  engine: GameEngine;
  geoData: any;
}

function getISO(feature: any): string {
  return feature.properties.ISO_A3 && feature.properties.ISO_A3 !== '-99'
    ? feature.properties.ISO_A3
    : (feature.properties.ADM0_A3 || 'UNK');
}

// Generate scatter positions for army dots around centroid
function generateDotPositions(count: number, seed: number): [number, number][] {
  const dots: [number, number][] = [];
  const maxDots = Math.min(count, 14);
  const rng = (i: number) => {
    const x = Math.sin(seed * 9301 + i * 7841) * 10000;
    return x - Math.floor(x);
  };
  for (let i = 0; i < maxDots; i++) {
    const angle = rng(i * 2) * Math.PI * 2;
    const radius = 8 + rng(i * 2 + 1) * 18;
    dots.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  return dots;
}

export default function GameHUD({ mapInstance, gameState, engine, geoData }: GameHUDProps) {
  const [selectedProvinceId, setSelectedProvinceId] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(true);

  // ── Drag state & Caching ──
  const dragRef = useRef<{
    active: boolean;
    sourceId: string | null;
    sourceCentroid: [number, number] | null;
    targetId: string | null;
  }>({ active: false, sourceId: null, sourceCentroid: null, targetId: null });

  // Map layers
  const geoLayerRef = useRef<any>(null);
  const markersRef = useRef<Map<string, any>>(new Map());
  const movementLayersRef = useRef<any[]>([]);
  const dragLineRef = useRef<any>(null);
  const dragTargetHighlightRef = useRef<any>(null);
  const mapEventsAttached = useRef(false);

  // Cache for reducing DOM updates
  const renderedStateRef = useRef<Map<string, { total: number, ownerId: string, resist: number }>>(new Map());

  const selectedProv = selectedProvinceId ? gameState.provinces.get(selectedProvinceId) : null;
  const nations = useMemo(() => [...gameState.nations.values()], [gameState]);
  const playerNation = nations.find(n => n.isPlayer);

  // Helper: player visible provinces (fog of war / clutter reduction)
  const getVisibleProvinces = useMemo(() => {
    const visible = new Set<string>();
    for (const [id, prov] of gameState.provinces) {
      if (prov.ownerId === 'player') {
        visible.add(id);
        for (const adj of prov.adjacentIds) visible.add(adj);
      }
    }
    return visible;
  }, [gameState.provinces, gameState.tick]); // tick will trigger re-eval when ownership changes

  // Province style by owner
  const getProvinceStyle = (provinceId: string, isDragTarget = false) => {
    const prov = gameState.provinces.get(provinceId);
    if (!prov || !prov.ownerId) {
      return {
        fillColor: '#1e293b',
        fillOpacity: 0.15,
        color: 'rgba(148,163,184,0.15)',
        weight: 0.8,
        opacity: 0.4,
      };
    }
    const nation = gameState.nations.get(prov.ownerId);
    const color = nation?.color || '#64748b';
    const isSelected = provinceId === selectedProvinceId;

    if (isDragTarget) {
      return { fillColor: color, fillOpacity: 0.6, color: '#fbbf24', weight: 3, opacity: 1 };
    }

    // Dim non-visible distant AI provinces
    const isVisible = getVisibleProvinces.has(provinceId);

    return {
      fillColor: color,
      fillOpacity: isSelected ? 0.5 : (isVisible ? 0.35 : 0.15),
      color: isSelected ? '#ffffff' : color,
      weight: isSelected ? 3 : (isVisible ? 1.5 : 0.8),
      opacity: isSelected ? 1 : (isVisible ? 0.8 : 0.3),
    };
  };

  // Helper to find which adjacent province contains a latlng
  const findTargetProvince = (sourceId: string, latlng: any) => {
    const source = gameState.provinces.get(sourceId);
    if (!source) return null;
    const pt = turf.point([latlng.lng, latlng.lat]);
    
    // Check neighbors
    for (const adjId of source.adjacentIds) {
      const feat = geoData.features.find((f: any) => getISO(f) === adjId);
      if (feat && turf.booleanPointInPolygon(pt, feat)) {
        return adjId;
      }
    }
    // Check self
    const sourceFeat = geoData.features.find((f: any) => getISO(f) === sourceId);
    if (sourceFeat && turf.booleanPointInPolygon(pt, sourceFeat)) return sourceId;
    return null;
  };

  // ── Create GeoJSON layer + map events (once) ──
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !geoData || gameState.phase !== 'playing') return;

    if (!geoLayerRef.current) {
      geoLayerRef.current = L.geoJSON(geoData, {
        style: (feature: any) => getProvinceStyle(getISO(feature)),
        filter: (feature: any) => {
          const iso = getISO(feature);
          return iso !== 'UNK' && iso !== 'ATA';
        }
      }).addTo(map);
    }

    if (!mapEventsAttached.current) {
      mapEventsAttached.current = true;

      map.on('mousemove', (e: any) => {
        if (!dragRef.current.active || !dragLineRef.current) return;
        dragLineRef.current.setLatLngs([dragRef.current.sourceCentroid, [e.latlng.lat, e.latlng.lng]]);
        
        // Target highlight
        const targetId = findTargetProvince(dragRef.current.sourceId!, e.latlng);
        if (targetId && targetId !== dragRef.current.sourceId) {
          dragRef.current.targetId = targetId;
          geoLayerRef.current.eachLayer((layer: any) => {
            const iso = getISO(layer.feature);
            if (iso === targetId) layer.setStyle(getProvinceStyle(iso, true));
            else layer.setStyle(getProvinceStyle(iso));
          });
        } else {
          dragRef.current.targetId = null;
          geoLayerRef.current.eachLayer((layer: any) => layer.setStyle(getProvinceStyle(getISO(layer.feature))));
        }
      });

      map.on('mouseup', (e: any) => {
        if (!dragRef.current.active) return;
        const sourceId = dragRef.current.sourceId;
        const targetId = findTargetProvince(sourceId!, e.latlng);

        if (dragLineRef.current) { map.removeLayer(dragLineRef.current); dragLineRef.current = null; }
        dragRef.current = { active: false, sourceId: null, sourceCentroid: null, targetId: null };
        map.dragging.enable();
        
        // Reset styles
        geoLayerRef.current.eachLayer((layer: any) => layer.setStyle(getProvinceStyle(getISO(layer.feature))));

        if (sourceId && targetId && sourceId !== targetId) {
          engine.sendPercent(sourceId, targetId, 0.5); // Send 50% on drag
        } else if (sourceId && (!targetId || targetId === sourceId)) {
          setSelectedProvinceId(prev => prev === sourceId ? null : sourceId);
        }
      });

      map.on('click', (e: any) => {
        if (!dragRef.current.active) {
          // Just normal click info
          const clickedId = findTargetProvince([...gameState.provinces.values()][0].id, e.latlng); // need any point in poly, better use feature
          for (const f of geoData.features) {
            if (getISO(f) === 'UNK' || getISO(f) === 'ATA') continue;
            if (turf.booleanPointInPolygon(turf.point([e.latlng.lng, e.latlng.lat]), f)) {
              const iso = getISO(f);
              setSelectedProvinceId(prev => prev === iso ? null : iso);
              break;
            }
          }
        }
      });
    }

    return () => {};
  }, [geoData, gameState.phase, getVisibleProvinces]);

  // ── Drag Start Handler ──
  const startDrag = React.useCallback((sourceId: string, centroid: [number, number], e: any) => {
    const map = mapInstance.current;
    if (!map) return;
    
    L.DomEvent.stopPropagation(e.originalEvent || e);
    L.DomEvent.preventDefault(e.originalEvent || e);

    dragRef.current = { active: true, sourceId, sourceCentroid: centroid, targetId: null };
    map.dragging.disable();

    if (dragLineRef.current) map.removeLayer(dragLineRef.current);
    dragLineRef.current = L.polyline([centroid, centroid], {
      color: playerNation?.color || '#22c55e', weight: 4, opacity: 0.9, dashArray: '8 8',
      className: 'drag-line', interactive: false,
    }).addTo(map);
  }, [playerNation]);

  // ── Update visuals each tick ──
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !geoLayerRef.current) return;

    if (!dragRef.current.active) {
      // Only style if not dragging to preserve drag highlight
      geoLayerRef.current.eachLayer((layer: any) => {
        layer.setStyle(getProvinceStyle(getISO(layer.feature)));
      });
    }

    // ── Army circles (multiple for large countries) ──
    const renderedIdsThisTick = new Set<string>();

    for (const [id, prov] of gameState.provinces) {
      const isVisible = getVisibleProvinces.has(id);
      
      if (!prov.ownerId || (!isVisible && prov.ownerId !== 'player')) {
        continue;
      }

      const total = totalTroops(prov.troops);
      const prev = renderedStateRef.current.get(id);
      
      renderedStateRef.current.set(id, { total, ownerId: prov.ownerId, resist: prov.resistanceTicks });
      const nation = gameState.nations.get(prov.ownerId);
      const color = nation?.color || '#64748b';

      const centers = prov.subCentroids || [prov.centroid];
      const fractionTotal = Math.floor(Math.max(1, total / centers.length));
      const fractionCr = Math.floor(prov.troops.car / centers.length);
      const fractionBk = Math.floor(prov.troops.bike / centers.length);

      centers.forEach((subCenter, idx) => {
        const markerId = `${id}-${idx}`;
        renderedIdsThisTick.add(markerId);

        // Skip DOM update if unchanged completely
        if (prev && prev.total === total && prev.ownerId === prov.ownerId && prev.resist === prov.resistanceTicks && markersRef.current.has(markerId)) {
          return;
        }

        const circleSize = Math.min(48, Math.max(16, 12 + Math.sqrt(fractionTotal) * 4));
        const dotSeed = subCenter[0] * 137 + subCenter[1] * 53;
        const dots = generateDotPositions(fractionTotal, dotSeed);

        let dotsHtml = '';
        dots.forEach(([dx, dy], i) => {
          let cls = 'army-dot-inf'; let size = 4;
          if (i < Math.ceil(dots.length * (fractionCr / Math.max(fractionTotal, 1)))) { cls = 'army-dot-car'; size = 7; }
          else if (i < Math.ceil(dots.length * ((fractionCr + fractionBk) / Math.max(fractionTotal, 1)))) { cls = 'army-dot-bike'; size = 5; }
          dotsHtml += `<span class="army-dot ${cls}" style="transform:translate(${dx}px,${dy}px);width:${size}px;height:${size}px;background:${color}"></span>`;
        });

        // Only show badge/resist once per province to avoid clutter
        const spawnBadge = (idx === 0 && prov.spawnPoints > 1 && isVisible)
          ? `<span class="army-spawn-badge">⭐${prov.spawnPoints}×</span>` : '';
        const resistBadge = (idx === 0 && prov.resistanceTicks > 0)
          ? `<span class="army-resist">⏳</span>` : '';

        const html = `<div class="army-group" style="--ac:${color}">
          <div class="army-dots-container">${dotsHtml}</div>
          <div class="army-main" style="width:${circleSize}px;height:${circleSize}px;background:${color}">
            <span class="army-count">${fractionTotal}</span>
          </div>
          ${spawnBadge}
          ${resistBadge}
        </div>`;

        let existing = markersRef.current.get(markerId);
        if (existing) {
          const el = existing.getElement();
          if (el) el.innerHTML = html;
          existing.setZIndexOffset(fractionTotal);
        } else {
          const icon = L.divIcon({ className: 'army-icon-wrapper', html, iconSize: [120, 120], iconAnchor: [60, 60] });
          existing = L.marker(subCenter, { icon, interactive: true, zIndexOffset: fractionTotal }).addTo(map);
          
          // Only player can drag their own armies
          if (prov.ownerId === 'player') {
            existing.on('mousedown', (e: any) => startDrag(id, subCenter, e));
          }
          markersRef.current.set(markerId, existing);
        }
      });
    }

    // Cleanup markers that are no longer visible (fog of war removed or conquered)
    for (const [markerId, m] of markersRef.current.entries()) {
      if (!renderedIdsThisTick.has(markerId)) {
        map.removeLayer(m);
        markersRef.current.delete(markerId);
        // Base id is string before hyphen
        const baseId = markerId.split('-')[0];
        renderedStateRef.current.delete(baseId);
      }
    }

    // ── Marching armies (movements) ──
    for (const l of movementLayersRef.current) { try { map.removeLayer(l); } catch {} }
    movementLayersRef.current = [];

    for (const mov of gameState.movements) {
      if (!getVisibleProvinces.has(mov.sourceId) && !getVisibleProvinces.has(mov.targetId)) continue; // Hide invisible marches

      const nation = gameState.nations.get(mov.nationId);
      const color = nation?.color || '#fff';
      const progress = 1 - (mov.ticksRemaining / mov.totalTicks);
      const total = totalTroops(mov.troops);

      // Calculate angle for arrows
      const p1 = map.project(mov.sourceCentroid, map.getZoom());
      const p2 = map.project(mov.targetCentroid, map.getZoom());
      const angleDeg = Math.atan2(p2.y - p1.y, p2.x - p1.x) * (180 / Math.PI);

      const positions: [number, number][] = [];
      const numArrows = Math.max(3, Math.min(8, Math.floor(total / 10) + 2)); // Dynamic tail length

      for (let i = 0; i < numArrows; i++) {
        const p = Math.max(0, progress - i * 0.06);
        positions.push([
          mov.sourceCentroid[0] + (mov.targetCentroid[0] - mov.sourceCentroid[0]) * p,
          mov.sourceCentroid[1] + (mov.targetCentroid[1] - mov.sourceCentroid[1]) * p
        ]);
      }

      movementLayersRef.current.push(L.polyline([mov.sourceCentroid, positions[0]], { 
        color, weight: 4, opacity: 0.3, dashArray: '6 10', className: 'march-trail-line', interactive: false 
      }).addTo(map));

      // Lead Arrow
      const leadSize = Math.min(40, Math.max(20, 15 + Math.sqrt(total) * 3));
      movementLayersRef.current.push(L.marker(positions[0], { 
        icon: L.divIcon({ 
          className: 'march-icon-wrapper', 
          html: `
            <div class="march-arrow-lead" style="transform: rotate(${angleDeg}deg); border-left-color: ${color}; width: ${leadSize}px;">
              <span class="march-count" style="transform: rotate(${-angleDeg}deg)">${total}</span>
            </div>`, 
          iconSize: [leadSize*2, leadSize*2], 
          iconAnchor: [leadSize, leadSize] 
        }), 
        interactive: false, zIndexOffset: 2000 
      }).addTo(map));

      // Trailing Arrows
      for (let i = 1; i < positions.length; i++) {
        const trailSize = Math.max(8, 20 - i * 2);
        movementLayersRef.current.push(L.marker(positions[i], { 
          icon: L.divIcon({ 
            className: 'march-icon-wrapper', 
            html: `<div class="march-arrow-trail" style="transform: rotate(${angleDeg}deg); border-left-color: ${color}; width: ${trailSize}px; opacity: ${0.9 - i * 0.15}"></div>`, 
            iconSize: [trailSize*2, trailSize*2], 
            iconAnchor: [trailSize, trailSize] 
          }), 
          interactive: false, zIndexOffset: 1999 - i 
        }).addTo(map));
      }
    }
  }, [gameState.tick, gameState.phase, selectedProvinceId, getVisibleProvinces]);

  const handleSetProduction = (unit: UnitType) => {
    if (selectedProvinceId) engine.setProduction(selectedProvinceId, unit);
  };
  const handleSpeedChange = (speed: GameSpeed) => engine.setSpeed(speed);

  const formatTime = (ticks: number) => {
    const secs = ticks * 3;
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins}:${s.toString().padStart(2, '0')}`;
  };

  const playerStats = engine.getNationStats('player');

  return (
    <>
      {/* ── Top Bar ── */}
      <div className="hud-top glass">
        <div className="hud-top-left">
          <span className="hud-brand">⚔️ MAPPY</span>
          <span className="hud-timer">{formatTime(gameState.tick)}</span>
        </div>
        <div className="hud-top-center">
          <div className="hud-speed">
            {([0, 1, 2, 3] as GameSpeed[]).map(s => (
              <button key={s} className={`hud-speed-btn ${gameState.speed === s ? 'active' : ''}`}
                onClick={() => handleSpeedChange(s)}>
                {s === 0 ? '⏸' : s === 1 ? '▶' : s === 2 ? '⏩' : '⏭'}
              </button>
            ))}
          </div>
        </div>
        <div className="hud-top-right">
          <div className="hud-stat">
            <span className="hud-stat-label">Provinces</span>
            <span className="hud-stat-value" style={{ color: playerNation?.color }}>{playerStats.provinceCount}</span>
          </div>
          <div className="hud-stat">
            <span className="hud-stat-label">Army</span>
            <span className="hud-stat-value">{playerStats.total}</span>
          </div>
        </div>
      </div>

      {/* ── Drag Hint ── */}
      <div className="hud-drag-hint glass">
        <span>🖱️ Drag from your territory to attack or reinforce</span>
      </div>

      {/* ── Nation Cards (left) ── */}
      <div className="hud-nations">
        {nations.map(nation => {
          const stats = engine.getNationStats(nation.id);
          if (stats.provinceCount === 0) return null;
          return (
            <div key={nation.id} className={`hud-nation-card glass ${nation.isPlayer ? 'is-player' : ''}`}>
              <div className="hud-nation-dot" style={{ background: nation.color }} />
              <div className="hud-nation-info">
                <span className="hud-nation-name" style={{ color: nation.color }}>{nation.name}</span>
                <span className="hud-nation-stats">{stats.provinceCount} prov · {stats.total} troops</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Province Info Panel (on click) ── */}
      {selectedProv && (
        <div className="hud-province-panel glass">
          <div className="hpp-header">
            <h3 className="hpp-name">{selectedProv.name}</h3>
            <button className="hpp-close" onClick={() => setSelectedProvinceId(null)}>✕</button>
          </div>

          <div className="hpp-owner">
            {selectedProv.ownerId ? (
              <span style={{ color: gameState.nations.get(selectedProv.ownerId)?.color }}>
                {gameState.nations.get(selectedProv.ownerId)?.name}
              </span>
            ) : <span className="hpp-neutral">Neutral</span>}
            {selectedProv.spawnPoints > 1 && (
              <span className="hpp-spawn-info">⭐ {selectedProv.spawnPoints}× production</span>
            )}
          </div>

          <div className="hpp-troops">
            <div className="hpp-troop-row">
              <span className="hpp-unit-icon infantry">●</span>
              <span className="hpp-unit-label">Infantry</span>
              <span className="hpp-unit-count">{selectedProv.troops.infantry}</span>
            </div>
            <div className="hpp-troop-row">
              <span className="hpp-unit-icon bike">◆</span>
              <span className="hpp-unit-label">Bike</span>
              <span className="hpp-unit-count">{selectedProv.troops.bike}</span>
            </div>
            <div className="hpp-troop-row">
              <span className="hpp-unit-icon car">⬠</span>
              <span className="hpp-unit-label">Car</span>
              <span className="hpp-unit-count">{selectedProv.troops.car}</span>
            </div>
          </div>

          {/* Production (only for player provinces) */}
          {selectedProv.ownerId === 'player' && (
            <div className="hpp-production">
              <span className="hpp-prod-label">Producing:</span>
              <div className="hpp-prod-buttons">
                {(['infantry', 'bike', 'car'] as UnitType[]).map(unit => (
                  <button key={unit}
                    className={`hpp-prod-btn ${selectedProv.production === unit ? 'active' : ''}`}
                    onClick={() => handleSetProduction(unit)}
                    title={`ATK:${UNIT_STATS[unit].attack} DEF:${UNIT_STATS[unit].defense} SPD:${UNIT_STATS[unit].travelTicks}t`}>
                    {UNIT_STATS[unit].icon} {UNIT_STATS[unit].label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {selectedProv.resistanceTicks > 0 && (
            <div className="hpp-resist">⏳ Resistance: {selectedProv.resistanceTicks} ticks</div>
          )}
        </div>
      )}

      {/* ── Battle Log ── */}
      <div className={`hud-log glass ${showLog ? 'open' : 'collapsed'}`}>
        <button className="hud-log-toggle" onClick={() => setShowLog(v => !v)}>
          📜 Battle Log {!showLog && `(${gameState.battleLog.length})`}
          <span className="hud-log-arrow">{showLog ? '▼' : '▲'}</span>
        </button>
        {showLog && (
          <div className="hud-log-entries">
            {gameState.battleLog.slice(0, 20).map(entry => (
              <div key={entry.id} className={`hud-log-entry ${entry.type}`}>
                <span className="hle-time">{formatTime(entry.tick)}</span>
                <span className="hle-msg">{entry.message}</span>
              </div>
            ))}
            {gameState.battleLog.length === 0 && <div className="hud-log-empty">No events yet…</div>}
          </div>
        )}
      </div>

      {/* ── Victory / Defeat ── */}
      {gameState.phase === 'victory' && (
        <div className="end-overlay victory">
          <div className="end-card glass">
            <div className="end-emoji">🏆</div>
            <h1 className="end-title">Victory!</h1>
            <p className="end-subtitle">You have conquered the world!</p>
            <div className="end-stats">
              <span>Time: {formatTime(gameState.tick)}</span>
              <span>Provinces: {playerStats.provinceCount}</span>
              <span>Army: {playerStats.total}</span>
            </div>
            <button className="end-btn" onClick={() => window.location.reload()}>Play Again</button>
          </div>
        </div>
      )}
      {gameState.phase === 'defeat' && (
        <div className="end-overlay defeat">
          <div className="end-card glass">
            <div className="end-emoji">💀</div>
            <h1 className="end-title">Defeat</h1>
            <p className="end-subtitle">Your nation has fallen…</p>
            <div className="end-stats"><span>Survived: {formatTime(gameState.tick)}</span></div>
            <button className="end-btn" onClick={() => window.location.reload()}>Try Again</button>
          </div>
        </div>
      )}
    </>
  );
}
