// ===== Mappy — Setup Phase (Territory Selection) =====
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { PLAYER_COLORS, COUNTRIES_URL } from './types';

const L = (window as any).L;
const turf = (window as any).turf;

interface SetupPhaseProps {
  mapInstance: React.MutableRefObject<any>;
  geoData: any;
  onStartGame: (name: string, color: string, provinceIds: Set<string>) => void;
}

const DEFAULT_STYLE = {
  fillColor: 'transparent',
  fillOpacity: 0,
  color: 'rgba(148,163,184,0.4)',
  weight: 0.8,
  opacity: 0.5,
};

const HOVER_STYLE = {
  fillColor: '#22c55e',
  fillOpacity: 0.15,
  color: '#22c55e',
  weight: 2,
  opacity: 0.6,
};

function getSelectedStyle(color: string) {
  return {
    fillColor: color,
    fillOpacity: 0.35,
    color: color,
    weight: 2.5,
    opacity: 0.9,
  };
}

function getISO(feature: any): string {
  return feature.properties.ISO_A3 && feature.properties.ISO_A3 !== '-99'
    ? feature.properties.ISO_A3
    : (feature.properties.ADM0_A3 || 'UNK');
}

export default function SetupPhase({ mapInstance, geoData, onStartGame }: SetupPhaseProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [nationName, setNationName] = useState('');
  const [nationColor, setNationColor] = useState(PLAYER_COLORS[0]);
  const [showPanel, setShowPanel] = useState(true);

  const geoLayerRef = useRef<any>(null);
  const selectedRef = useRef<Set<string>>(new Set());
  const colorRef = useRef(nationColor);

  useEffect(() => { selectedRef.current = selectedIds; }, [selectedIds]);
  useEffect(() => { colorRef.current = nationColor; }, [nationColor]);

  // Re-style layers when color changes
  useEffect(() => {
    if (!geoLayerRef.current) return;
    geoLayerRef.current.eachLayer((layer: any) => {
      const iso = getISO(layer.feature);
      if (selectedRef.current.has(iso)) {
        layer.setStyle(getSelectedStyle(nationColor));
      }
    });
  }, [nationColor]);

  const toggleProvince = useCallback((iso: string, layer: any) => {
    const current = new Set(selectedRef.current);
    if (current.has(iso)) {
      current.delete(iso);
      layer.setStyle(DEFAULT_STYLE);
    } else {
      current.add(iso);
      layer.setStyle(getSelectedStyle(colorRef.current));
    }
    selectedRef.current = current;
    setSelectedIds(current);
  }, []);

  // Add GeoJSON layer for territory selection
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !geoData) return;

    if (geoLayerRef.current) map.removeLayer(geoLayerRef.current);

    geoLayerRef.current = L.geoJSON(geoData, {
      style: (feature: any) => {
        const iso = getISO(feature);
        if (iso === 'ATA') return { ...DEFAULT_STYLE, fillOpacity: 0, opacity: 0.1 }; // dim Antarctica
        if (selectedRef.current.has(iso)) return getSelectedStyle(colorRef.current);
        return DEFAULT_STYLE;
      },
      filter: (feature: any) => {
        const iso = getISO(feature);
        return iso !== 'UNK';
      },
      onEachFeature: (feature: any, layer: any) => {
        const iso = getISO(feature);
        const name = feature.properties.NAME || feature.properties.ADMIN || iso;
        if (iso === 'ATA') return; // skip Antarctica interaction

        layer.bindTooltip(name, {
          sticky: true,
          className: 'game-tooltip',
          direction: 'top',
          offset: [0, -10],
        });

        layer.on('mouseover', () => {
          if (!selectedRef.current.has(iso)) layer.setStyle(HOVER_STYLE);
          layer.bringToFront();
        });
        layer.on('mouseout', () => {
          if (!selectedRef.current.has(iso)) layer.setStyle(DEFAULT_STYLE);
          else layer.setStyle(getSelectedStyle(colorRef.current));
        });
        layer.on('click', (e: any) => {
          L.DomEvent.stopPropagation(e);
          toggleProvince(iso, layer);
        });
      },
    }).addTo(map);

    return () => {
      if (geoLayerRef.current && map) {
        map.removeLayer(geoLayerRef.current);
        geoLayerRef.current = null;
      }
    };
  }, [geoData, mapInstance, toggleProvince]);

  const handleStartGame = () => {
    if (selectedIds.size < 2) {
      alert('Select at least 2 territories to form your nation!');
      return;
    }
    // Remove the setup GeoJSON layer
    if (geoLayerRef.current && mapInstance.current) {
      mapInstance.current.removeLayer(geoLayerRef.current);
      geoLayerRef.current = null;
    }
    onStartGame(nationName, nationColor, selectedIds);
  };

  const selectedNames: string[] = [];
  if (geoData) {
    for (const feature of geoData.features) {
      const iso = getISO(feature);
      if (selectedIds.has(iso)) {
        selectedNames.push(feature.properties.NAME || feature.properties.ADMIN || iso);
      }
    }
  }

  return (
    <>
      {/* Setup Banner */}
      <div className="setup-banner">
        <div className="setup-banner-icon">🗺️</div>
        <div className="setup-banner-text">
          <strong>Build Your Nation</strong>
          <span>Click territories on the map to claim them</span>
        </div>
      </div>

      {/* Setup Panel */}
      {showPanel && (
        <div className="setup-panel glass">
          <div className="setup-header">
            <h2 className="setup-title">🏴 Nation Setup</h2>
            <button className="setup-minimize" onClick={() => setShowPanel(false)}>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12" /></svg>
            </button>
          </div>

          {/* Nation Name */}
          <div className="setup-field">
            <label className="setup-label">Nation Name</label>
            <input
              type="text"
              className="setup-input"
              placeholder="Enter your nation's name…"
              value={nationName}
              onChange={(e) => setNationName(e.target.value)}
            />
          </div>

          {/* Color Picker */}
          <div className="setup-field">
            <label className="setup-label">Color</label>
            <div className="setup-colors">
              {PLAYER_COLORS.map(c => (
                <button
                  key={c}
                  className={`setup-color-swatch ${nationColor === c ? 'active' : ''}`}
                  style={{ background: c }}
                  onClick={() => setNationColor(c)}
                />
              ))}
            </div>
          </div>

          {/* Selected Territory Count */}
          <div className="setup-count">
            <span className="setup-count-num" style={{ color: nationColor }}>
              {selectedIds.size}
            </span>
            <span className="setup-count-label">
              {selectedIds.size === 1 ? 'territory' : 'territories'} selected
            </span>
          </div>

          {/* Territory Tags */}
          {selectedNames.length > 0 && (
            <div className="setup-territories">
              {selectedNames.map((name, i) => (
                <span key={i} className="setup-tag" style={{
                  background: `${nationColor}1a`,
                  color: nationColor,
                  borderColor: `${nationColor}44`,
                }}>
                  {name}
                </span>
              ))}
            </div>
          )}

          {/* Start Game Button */}
          <button
            className="setup-start-btn"
            onClick={handleStartGame}
            disabled={selectedIds.size < 2}
            style={{
              background: selectedIds.size >= 2 ? nationColor : undefined,
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
            Start Conquest ({selectedIds.size} territories)
          </button>
        </div>
      )}

      {/* Minimized restore */}
      {!showPanel && (
        <button className="setup-restore glass" onClick={() => setShowPanel(true)}>
          🏴 <span className="setup-restore-count">{selectedIds.size}</span>
        </button>
      )}
    </>
  );
}
