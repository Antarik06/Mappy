import React, { useEffect, useRef, useState, useCallback } from 'react';

const L = (window as any).L;
const turf = (window as any).turf;

const COUNTRIES_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson';

interface CountryBuilderProps {
  mapInstance: React.MutableRefObject<any>;
  isActive: boolean;
  onToggle: () => void;
  isDark: boolean;
}

interface CustomCountry {
  id: string;
  name: string;
  color: string;
  isos: Set<string>;
}

interface CountryStats {
  count: number;
  names: string[];
  totalAreaKm2: number;
  totalPopulation: number;
  totalGDP: number;
}

const COUNTRY_PALETTE = [
  '#8b5cf6', '#3b82f6', '#22c55e', '#ef4444', '#f97316',
  '#ec4899', '#14b8a6', '#eab308', '#6366f1', '#f43f5e',
];

const DEFAULT_STYLE = {
  fillColor: 'transparent',
  fillOpacity: 0,
  color: '#64748b',
  weight: 0.8,
  opacity: 0.4,
};

const HOVER_STYLE = {
  fillColor: '#a78bfa',
  fillOpacity: 0.22,
  color: '#a78bfa',
  weight: 2,
  opacity: 0.7,
};

function getSelectedStyle(color: string) {
  return {
    fillColor: color,
    fillOpacity: 0.35,
    color: color,
    weight: 2.5,
    opacity: 0.9,
    dashArray: '8 4',
  };
}

function getMergedStyle(color: string) {
  return {
    fillColor: color,
    fillOpacity: 0.18,
    color: color,
    weight: 3.5,
    opacity: 1,
    dashArray: '12 6',
    lineCap: 'round' as const,
  };
}

let nextId = 1;
function createCountry(color: string): CustomCountry {
  return { id: `country-${nextId++}`, name: '', color, isos: new Set() };
}

export default function CountryBuilder({ mapInstance, isActive, onToggle, isDark }: CountryBuilderProps) {
  const [geoData, setGeoData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [countries, setCountries] = useState<CustomCountry[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [showPanel, setShowPanel] = useState(true);

  const geoLayerRef = useRef<any>(null);
  const mergedLayersRef = useRef<any[]>([]);
  const countriesRef = useRef<CustomCountry[]>([]);
  const activeIdxRef = useRef(0);
  const geoDataRef = useRef<any>(null);

  // Sync refs
  useEffect(() => { countriesRef.current = countries; }, [countries]);
  useEffect(() => { activeIdxRef.current = activeIdx; }, [activeIdx]);

  // Init first country on activation
  useEffect(() => {
    if (isActive && countries.length === 0) {
      const first = createCountry(COUNTRY_PALETTE[0]);
      setCountries([first]);
      countriesRef.current = [first];
    }
  }, [isActive]);

  // Fetch country boundaries on activation
  useEffect(() => {
    if (!isActive || geoData) return;
    setLoading(true);
    fetch(COUNTRIES_URL)
      .then(r => r.json())
      .then(data => {
        setGeoData(data);
        geoDataRef.current = data;
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
        alert('Failed to load country boundaries. Please try again.');
      });
  }, [isActive, geoData]);

  // Find which custom country owns an ISO
  const findOwner = useCallback((iso: string): number => {
    for (let i = 0; i < countriesRef.current.length; i++) {
      if (countriesRef.current[i].isos.has(iso)) return i;
    }
    return -1;
  }, []);

  // Compute stats for a custom country
  const computeStats = useCallback((cc: CustomCountry): CountryStats | null => {
    const data = geoDataRef.current;
    if (!data || cc.isos.size === 0) return null;
    const names: string[] = [];
    let totalArea = 0, totalPop = 0, totalGDP = 0;

    data.features.forEach((f: any) => {
      const iso = f.properties.ISO_A3 || f.properties.ADM0_A3 || '';
      if (cc.isos.has(iso)) {
        names.push(f.properties.NAME || f.properties.ADMIN || iso);
        try { totalArea += turf.area(f) / 1e6; } catch { }
        totalPop += (f.properties.POP_EST || 0);
        totalGDP += (f.properties.GDP_MD || f.properties.GDP_MD_EST || 0);
      }
    });

    return { count: cc.isos.size, names, totalAreaKm2: totalArea, totalPopulation: totalPop, totalGDP: totalGDP };
  }, []);

  // Render merged layers for ALL custom countries
  const renderAllMerged = useCallback(() => {
    const map = mapInstance.current;
    if (!map) return;
    const data = geoDataRef.current;
    if (!data) return;

    // Remove old merged layers
    mergedLayersRef.current.forEach(l => { try { map.removeLayer(l); } catch {} });
    mergedLayersRef.current = [];

    countriesRef.current.forEach(cc => {
      if (cc.isos.size === 0) return;
      const features = data.features.filter((f: any) => {
        const iso = f.properties.ISO_A3 || f.properties.ADM0_A3 || '';
        return cc.isos.has(iso);
      });
      if (features.length === 0) return;

      try {
        let merged = features[0];
        for (let i = 1; i < features.length; i++) {
          try {
            merged = turf.union(turf.featureCollection([merged, features[i]]));
          } catch { }
        }
        if (merged) {
          const layer = L.geoJSON(merged, { style: getMergedStyle(cc.color), interactive: false }).addTo(map);
          mergedLayersRef.current.push(layer);
        }
      } catch {
        const layer = L.geoJSON(turf.featureCollection(features), { style: getMergedStyle(cc.color), interactive: false }).addTo(map);
        mergedLayersRef.current.push(layer);
      }
    });
  }, [mapInstance]);

  // Toggle a country's selection for the active custom country
  const toggleCountry = useCallback((iso: string, layer: any) => {
    const idx = activeIdxRef.current;
    const all = [...countriesRef.current];
    const ownerIdx = findOwner(iso);

    if (ownerIdx === idx) {
      // Deselect from current
      all[idx] = { ...all[idx], isos: new Set([...all[idx].isos].filter(i => i !== iso)) };
      layer.setStyle(DEFAULT_STYLE);
    } else if (ownerIdx >= 0) {
      // Belongs to another country — steal it
      all[ownerIdx] = { ...all[ownerIdx], isos: new Set([...all[ownerIdx].isos].filter(i => i !== iso)) };
      all[idx] = { ...all[idx], isos: new Set([...all[idx].isos, iso]) };
      layer.setStyle(getSelectedStyle(all[idx].color));
    } else {
      // Not owned — add to current
      all[idx] = { ...all[idx], isos: new Set([...all[idx].isos, iso]) };
      layer.setStyle(getSelectedStyle(all[idx].color));
    }

    countriesRef.current = all;
    setCountries([...all]);
    renderAllMerged();
  }, [findOwner, renderAllMerged]);

  // Add/remove GeoJSON layer when active state or data changes
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    if (!isActive) {
      if (geoLayerRef.current) { map.removeLayer(geoLayerRef.current); geoLayerRef.current = null; }
      mergedLayersRef.current.forEach(l => { try { map.removeLayer(l); } catch {} });
      mergedLayersRef.current = [];
      return;
    }

    if (!geoData) return;

    if (geoLayerRef.current) map.removeLayer(geoLayerRef.current);

    geoLayerRef.current = L.geoJSON(geoData, {
      style: (feature: any) => {
        const iso = feature.properties.ISO_A3 || feature.properties.ADM0_A3 || '';
        const ownerIdx = findOwner(iso);
        if (ownerIdx >= 0) return getSelectedStyle(countriesRef.current[ownerIdx].color);
        return DEFAULT_STYLE;
      },
      onEachFeature: (feature: any, layer: any) => {
        const iso = feature.properties.ISO_A3 || feature.properties.ADM0_A3 || '';
        const name = feature.properties.NAME || feature.properties.ADMIN || iso;

        layer.bindTooltip(name, { sticky: true, className: 'country-tooltip', direction: 'top', offset: [0, -10] });

        layer.on('mouseover', () => {
          if (findOwner(iso) < 0) layer.setStyle(HOVER_STYLE);
          layer.bringToFront();
        });
        layer.on('mouseout', () => {
          const oi = findOwner(iso);
          if (oi < 0) layer.setStyle(DEFAULT_STYLE);
          else layer.setStyle(getSelectedStyle(countriesRef.current[oi].color));
        });

        layer.on('click', (e: any) => {
          L.DomEvent.stopPropagation(e);
          toggleCountry(iso, layer);
        });
      },
    }).addTo(map);

    renderAllMerged();

    return () => {
      if (geoLayerRef.current && map) { map.removeLayer(geoLayerRef.current); geoLayerRef.current = null; }
    };
  }, [isActive, geoData, mapInstance, toggleCountry, renderAllMerged, findOwner]);

  // Re-style all layers when active country changes
  useEffect(() => {
    if (!geoLayerRef.current) return;
    geoLayerRef.current.eachLayer((layer: any) => {
      const iso = layer.feature?.properties?.ISO_A3 || layer.feature?.properties?.ADM0_A3 || '';
      const oi = findOwner(iso);
      if (oi >= 0) layer.setStyle(getSelectedStyle(countriesRef.current[oi].color));
      else layer.setStyle(DEFAULT_STYLE);
    });
  }, [activeIdx, countries, findOwner]);

  const addNewCountry = () => {
    const colorIdx = countries.length % COUNTRY_PALETTE.length;
    const newC = createCountry(COUNTRY_PALETTE[colorIdx]);
    const updated = [...countries, newC];
    setCountries(updated);
    countriesRef.current = updated;
    setActiveIdx(updated.length - 1);
    activeIdxRef.current = updated.length - 1;
  };

  const removeCountry = (idx: number) => {
    if (countries.length <= 1) return;
    const updated = countries.filter((_, i) => i !== idx);
    setCountries(updated);
    countriesRef.current = updated;
    const newIdx = Math.min(activeIdx, updated.length - 1);
    setActiveIdx(newIdx);
    activeIdxRef.current = newIdx;

    // Re-style and re-render
    if (geoLayerRef.current) {
      geoLayerRef.current.eachLayer((layer: any) => {
        const iso = layer.feature?.properties?.ISO_A3 || layer.feature?.properties?.ADM0_A3 || '';
        let found = false;
        for (const cc of updated) {
          if (cc.isos.has(iso)) { layer.setStyle(getSelectedStyle(cc.color)); found = true; break; }
        }
        if (!found) layer.setStyle(DEFAULT_STYLE);
      });
    }
    setTimeout(() => renderAllMerged(), 50);
  };

  const updateCountryName = (idx: number, name: string) => {
    const updated = [...countries];
    updated[idx] = { ...updated[idx], name };
    setCountries(updated);
    countriesRef.current = updated;
  };

  const updateCountryColor = (idx: number, color: string) => {
    const updated = [...countries];
    updated[idx] = { ...updated[idx], color };
    setCountries(updated);
    countriesRef.current = updated;

    // Re-style layers
    if (geoLayerRef.current) {
      geoLayerRef.current.eachLayer((layer: any) => {
        const iso = layer.feature?.properties?.ISO_A3 || layer.feature?.properties?.ADM0_A3 || '';
        if (updated[idx].isos.has(iso)) layer.setStyle(getSelectedStyle(color));
      });
    }
    renderAllMerged();
  };

  const handleResetAll = () => {
    const first = createCountry(COUNTRY_PALETTE[0]);
    setCountries([first]);
    countriesRef.current = [first];
    setActiveIdx(0);
    activeIdxRef.current = 0;

    const map = mapInstance.current;
    mergedLayersRef.current.forEach(l => { try { map?.removeLayer(l); } catch {} });
    mergedLayersRef.current = [];

    if (geoLayerRef.current) {
      geoLayerRef.current.eachLayer((layer: any) => layer.setStyle(DEFAULT_STYLE));
    }
  };

  const handleDownloadAll = () => {
    const data = geoDataRef.current;
    if (!data) return;
    const allFeatures: any[] = [];

    countries.forEach(cc => {
      if (cc.isos.size === 0) return;
      const features = data.features.filter((f: any) => {
        const iso = f.properties.ISO_A3 || f.properties.ADM0_A3 || '';
        return cc.isos.has(iso);
      });
      if (features.length === 0) return;

      try {
        let merged = features[0];
        for (let i = 1; i < features.length; i++) {
          try { merged = turf.union(turf.featureCollection([merged, features[i]])); } catch { }
        }
        merged.properties = {
          name: cc.name || `Country ${countries.indexOf(cc) + 1}`,
          color: cc.color,
          territories: features.map((f: any) => f.properties.NAME || f.properties.ADMIN),
        };
        allFeatures.push(merged);
      } catch {
        features.forEach((f: any) => allFeatures.push(f));
      }
    });

    const exportData = turf.featureCollection(allFeatures);
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'custom-countries.geojson';
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatNumber = (n: number): string => {
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    return n.toLocaleString();
  };

  const formatArea = (km2: number): string => {
    if (km2 >= 1e6) return `${(km2 / 1e6).toFixed(2)}M km²`;
    if (km2 >= 1e3) return `${(km2 / 1e3).toFixed(1)}K km²`;
    return `${Math.round(km2)} km²`;
  };

  if (!isActive) return null;

  const activeCountry = countries[activeIdx];
  const activeStats = activeCountry ? computeStats(activeCountry) : null;
  const totalSelected = countries.reduce((s, c) => s + c.isos.size, 0);

  return (
    <>
      {/* Loading overlay */}
      {loading && (
        <div className="cb-loading-overlay">
          <div className="cb-loading-card glass">
            <div className="cb-loading-spinner"></div>
            <span>Loading country boundaries…</span>
          </div>
        </div>
      )}

      {/* Mode indicator banner */}
      <div className="cb-mode-banner glass">
        <div className="cb-banner-icon">🌍</div>
        <div className="cb-banner-text">
          <strong>Country Builder</strong>
          <span>Painting as: <span style={{color: activeCountry?.color, fontWeight: 700}}>{activeCountry?.name || `Country ${activeIdx + 1}`}</span></span>
        </div>
        <button className="cb-banner-close" onClick={onToggle} title="Exit mode">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Stats Panel */}
      {showPanel && (
        <div className="cb-stats-panel glass">
          {/* Country tabs */}
          <div className="cb-tabs">
            {countries.map((cc, i) => (
              <button
                key={cc.id}
                className={`cb-tab ${i === activeIdx ? 'active' : ''}`}
                onClick={() => { setActiveIdx(i); activeIdxRef.current = i; }}
                style={{ borderBottomColor: i === activeIdx ? cc.color : 'transparent' }}
              >
                <span className="cb-tab-dot" style={{ background: cc.color }}></span>
                <span className="cb-tab-name">{cc.name || `Country ${i + 1}`}</span>
                {countries.length > 1 && (
                  <span className="cb-tab-remove" onClick={(e) => { e.stopPropagation(); removeCountry(i); }}>×</span>
                )}
              </button>
            ))}
            <button className="cb-tab cb-tab-add" onClick={addNewCountry} title="Add new country">
              +
            </button>
          </div>

          {/* Active country config */}
          {activeCountry && (
            <div className="cb-active-section">
              <div className="cb-stats-header">
                <div className="cb-name-section">
                  <input
                    type="text"
                    className="cb-name-input"
                    placeholder={`Name Country ${activeIdx + 1}…`}
                    value={activeCountry.name}
                    onChange={(e) => updateCountryName(activeIdx, e.target.value)}
                  />
                  <span className="cb-country-count" style={{ color: activeCountry.color }}>
                    {activeCountry.isos.size} {activeCountry.isos.size === 1 ? 'territory' : 'territories'}
                  </span>
                </div>
                <button className="cb-panel-toggle" onClick={() => setShowPanel(false)} title="Minimize">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>
              </div>

              {/* Color picker */}
              <div className="cb-color-row">
                <span className="cb-color-label">Color</span>
                <div className="cb-color-swatches">
                  {COUNTRY_PALETTE.map(c => (
                    <button
                      key={c}
                      className={`cb-color-swatch ${activeCountry.color === c ? 'active' : ''}`}
                      style={{ background: c }}
                      onClick={() => updateCountryColor(activeIdx, c)}
                    />
                  ))}
                </div>
              </div>

              {/* Stats */}
              {activeStats && (
                <>
                  <div className="cb-stats-grid">
                    <div className="cb-stat-card">
                      <span className="cb-stat-icon">📐</span>
                      <div className="cb-stat-info">
                        <span className="cb-stat-label">Area</span>
                        <span className="cb-stat-value">{formatArea(activeStats.totalAreaKm2)}</span>
                      </div>
                    </div>
                    <div className="cb-stat-card">
                      <span className="cb-stat-icon">👥</span>
                      <div className="cb-stat-info">
                        <span className="cb-stat-label">Population</span>
                        <span className="cb-stat-value">{formatNumber(activeStats.totalPopulation)}</span>
                      </div>
                    </div>
                    <div className="cb-stat-card">
                      <span className="cb-stat-icon">💰</span>
                      <div className="cb-stat-info">
                        <span className="cb-stat-label">GDP</span>
                        <span className="cb-stat-value">${formatNumber(activeStats.totalGDP)}M</span>
                      </div>
                    </div>
                  </div>

                  <div className="cb-selected-list">
                    <div className="cb-list-label">Territories</div>
                    <div className="cb-territories">
                      {activeStats.names.map((name, i) => (
                        <span key={i} className="cb-territory-tag" style={{ background: `${activeCountry.color}1f`, color: activeCountry.color, borderColor: `${activeCountry.color}44` }}>{name}</span>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="cb-actions">
            <button className="cb-btn cb-btn-download" onClick={handleDownloadAll}>
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Export All
            </button>
            <button className="cb-btn cb-btn-reset" onClick={handleResetAll}>
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
              </svg>
              Reset All
            </button>
          </div>
        </div>
      )}

      {/* Minimized panel restore button */}
      {!showPanel && (
        <button className="cb-restore-btn glass" onClick={() => setShowPanel(true)} title="Show stats">
          <span>🌍</span>
          <span className="cb-restore-count">{totalSelected}</span>
        </button>
      )}
    </>
  );
}
