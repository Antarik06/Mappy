import React, { useEffect, useRef, useState, FormEvent } from 'react';

const GH_API_KEY = '57d9d0f6-832c-4037-9721-35b7bf7bc81c';
const TILE_LIGHT = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

const ROUTE_COLORS: Record<string, string> = { car: '#3b82f6', bike: '#22c55e', foot: '#f97316' };
const GH_VEHICLES: Record<string, string> = { car: 'car', bike: 'bike', foot: 'foot' };

const L = (window as any).L;
const polyline = (window as any).polyline;

export default function App() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);

  const userMarkerRef = useRef<any>(null);
  const userCircleRef = useRef<any>(null);
  const destMarkerRef = useRef<any>(null);
  const routeLineRef = useRef<any>(null);
  const tileLayerRef = useRef<any>(null);

  const [currentLatLng, setCurrentLatLng] = useState<any>(null);
  const [currentMode, setCurrentMode] = useState<'car' | 'bike' | 'foot'>('car');
  const [isDark, setIsDark] = useState<boolean>(() => localStorage.getItem('mappy-dark') === 'true');
  const [isRouting, setIsRouting] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [routeInfo, setRouteInfo] = useState<{ distance: string, duration: string, instructions: any[] } | null>(null);

  const currentLatLngRef = useRef(currentLatLng);
  const modeRef = useRef(currentMode);
  const isRoutingRef = useRef(isRouting);
  const lastDestRef = useRef<{ lat: number, lng: number, name: string } | null>(null);
  const searchDebounce = useRef<any>(null);

  useEffect(() => { currentLatLngRef.current = currentLatLng; }, [currentLatLng]);
  useEffect(() => { modeRef.current = currentMode; }, [currentMode]);
  useEffect(() => { isRoutingRef.current = isRouting; }, [isRouting]);

  useEffect(() => {
    if (!mapContainer.current || mapInstance.current) return;

    mapInstance.current = L.map(mapContainer.current, { zoomControl: false }).setView([20, 0], 2);
    L.control.zoom({ position: 'bottomright' }).addTo(mapInstance.current);

    tileLayerRef.current = L.tileLayer(isDark ? TILE_DARK : TILE_LIGHT, {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(mapInstance.current);

    if (isDark) document.documentElement.setAttribute('data-theme', 'dark');

    const geoId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        const accuracy = pos.coords.accuracy;
        const latLng = L.latLng(lat, lon);
        setCurrentLatLng(latLng);

        if (userMarkerRef.current) mapInstance.current.removeLayer(userMarkerRef.current);
        if (userCircleRef.current) mapInstance.current.removeLayer(userCircleRef.current);

        const userIcon = L.divIcon({ className: 'user-marker', iconSize: [18, 18], iconAnchor: [9, 9] });
        userMarkerRef.current = L.marker(latLng, { icon: userIcon }).addTo(mapInstance.current).bindPopup('📍 You are here');

        userCircleRef.current = L.circle(latLng, { radius: accuracy, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.08, weight: 1.5 }).addTo(mapInstance.current);

        if (!mapInstance.current.zoomed) {
          mapInstance.current.fitBounds(userCircleRef.current.getBounds());
          mapInstance.current.zoomed = true;
        }
      },
      (err) => {
        if (err.code === 1) alert('Please allow location access.');
      },
      { enableHighAccuracy: true }
    );

    return () => {
      navigator.geolocation.clearWatch(geoId);
      mapInstance.current?.remove();
      mapInstance.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapInstance.current) return;
    const onClick = (e: any) => {
      setSuggestions([]);
      const start = currentLatLngRef.current;
      if (!start) { alert('Waiting for your location…'); return; }
      drawRoute(start, e.latlng);
    };
    mapInstance.current.on('click', onClick);
    return () => { mapInstance.current?.off('click', onClick); };
  }, []);

  const drawRoute = async (start: any, end: any, destName?: string) => {
    if (isRoutingRef.current) return;
    setIsRouting(true);
    setSuggestions([]);

    const nameToUse = destName || `${end.lat.toFixed(4)}, ${end.lng.toFixed(4)}`;
    lastDestRef.current = { lat: end.lat, lng: end.lng, name: nameToUse };

    try {
      const mode = modeRef.current;
      const vehicle = GH_VEHICLES[mode];
      const url = `https://graphhopper.com/api/1/route?point=${start.lat},${start.lng}&point=${end.lat},${end.lng}&vehicle=${vehicle}&points_encoded=true&instructions=true&locale=en&key=${GH_API_KEY}`;

      const res = await fetch(url);
      const data = await res.json();

      if (!data.paths || !data.paths.length) {
        alert('No route found. Try a different transport mode or destination.');
        setIsRouting(false);
        return;
      }

      const path = data.paths[0];
      const coords = polyline.decode(path.points);

      if (routeLineRef.current) mapInstance.current.removeLayer(routeLineRef.current);
      if (destMarkerRef.current) mapInstance.current.removeLayer(destMarkerRef.current);

      routeLineRef.current = L.polyline(coords, {
        color: ROUTE_COLORS[mode],
        weight: 5,
        opacity: 0.85,
        smoothFactor: 1.2
      }).addTo(mapInstance.current);

      const destIcon = L.divIcon({ className: 'dest-marker', iconSize: [14, 14], iconAnchor: [7, 7] });
      destMarkerRef.current = L.marker(end, { icon: destIcon }).addTo(mapInstance.current).bindPopup(`🏁 ${nameToUse}`).openPopup();

      mapInstance.current.fitBounds(routeLineRef.current.getBounds(), { padding: [60, 60] });

      const distKm = path.distance / 1000;
      const strDist = distKm >= 1 ? `${distKm.toFixed(1)} km` : `${Math.round(path.distance)} m`;

      const totalSec = path.time / 1000;
      const hrs = Math.floor(totalSec / 3600);
      const mins = Math.round((totalSec % 3600) / 60);
      const strDur = hrs > 0 ? `${hrs}h ${mins}m` : `${mins} min`;

      setRouteInfo({
        distance: strDist,
        duration: strDur,
        instructions: path.instructions || []
      });

    } catch (err) {
      console.error(err);
      alert('Failed to fetch route. Please try again.');
    } finally {
      setIsRouting(false);
    }
  };

  const handleSearchSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!searchTerm.trim()) return;
    const start = currentLatLngRef.current;
    if (!start) { alert('Waiting for your location…'); return; }

    setSuggestions([]);
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchTerm.trim())}&limit=1`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (!data.length) { alert('Location not found'); return; }
      const dest = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      drawRoute(start, dest, data[0].display_name.split(',')[0]);
    } catch {
      alert('Search failed');
    }
  };

  const onSearchChange = (val: string) => {
    setSearchTerm(val);
    clearTimeout(searchDebounce.current);
    if (val.trim().length < 3) { setSuggestions([]); return; }
    searchDebounce.current = setTimeout(async () => {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(val.trim())}&limit=5&addressdetails=1`;
      try {
        const res = await fetch(url);
        const data = await res.json();
        setSuggestions(data);
      } catch { }
    }, 300);
  };

  const selectSuggestion = (r: any) => {
    const start = currentLatLngRef.current;
    const name = r.display_name.split(',')[0].trim();
    setSearchTerm(name);
    setSuggestions([]);
    if (!start) { alert('Waiting location…'); return; }
    const dest = { lat: parseFloat(r.lat), lng: parseFloat(r.lon) };
    drawRoute(start, dest, name);
  };

  const handleClearRoute = () => {
    if (routeLineRef.current) mapInstance.current.removeLayer(routeLineRef.current);
    if (destMarkerRef.current) mapInstance.current.removeLayer(destMarkerRef.current);
    routeLineRef.current = null;
    destMarkerRef.current = null;
    lastDestRef.current = null;
    setRouteInfo(null);
  };

  const handleModeChange = (m: 'car' | 'bike' | 'foot') => {
    setCurrentMode(m);
    modeRef.current = m;
    if (lastDestRef.current && currentLatLngRef.current) {
      drawRoute(currentLatLngRef.current, lastDestRef.current, lastDestRef.current.name);
    }
  };

  const handleToggleDark = () => {
    const nextDark = !isDark;
    setIsDark(nextDark);
    localStorage.setItem('mappy-dark', String(nextDark));
    document.documentElement.setAttribute('data-theme', nextDark ? 'dark' : '');
    if (tileLayerRef.current) {
      mapInstance.current.removeLayer(tileLayerRef.current);
      tileLayerRef.current = L.tileLayer(nextDark ? TILE_DARK : TILE_LIGHT, { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(mapInstance.current);
    }
  };

  const handleLocateMe = () => {
    if (currentLatLngRef.current && mapInstance.current) {
      mapInstance.current.flyTo(currentLatLngRef.current, 16, { duration: 1.2 });
    } else {
      alert('Still acquiring your location…');
    }
  };

  return (
    <>
      <div id="map" ref={mapContainer} className="absolute inset-0 w-full h-full z-0" />

      {/* SEARCH PANEL */}
      <div className="search-panel glass" id="searchPanel" onClick={() => setSuggestions([])}>
        <form className="search-bar" onSubmit={handleSearchSubmit}>
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Search a destination…"
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          <div className={`spinner ${isRouting ? 'active' : ''}`}></div>
          <button type="submit" className="btn-go" disabled={isRouting}>Go</button>
        </form>
        {suggestions.length > 0 && (
          <ul className="autocomplete-list">
            {suggestions.map((r, i) => {
              const parts = r.display_name.split(',');
              const name = parts[0].trim();
              const region = parts.slice(1, 3).join(',').trim();
              return (
                <li key={i} onClick={(e) => { e.stopPropagation(); selectSuggestion(r); }}>
                  <svg className="ac-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
                  <span className="ac-name">{name}</span>
                  <span className="ac-region">{region}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* MODE SELECTOR */}
      <div className="mode-selector glass">
        <button className={`mode-btn car ${currentMode === 'car' ? 'active' : ''}`} onClick={() => handleModeChange('car')}>
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 17h14M5 17a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1l2-3h8l2 3h1a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2M5 17v2m14-2v2" /><circle cx="7.5" cy="14.5" r="1.5" /><circle cx="16.5" cy="14.5" r="1.5" /></svg>
          <span className="mode-label">Car</span>
        </button>
        <button className={`mode-btn bike ${currentMode === 'bike' ? 'active' : ''}`} onClick={() => handleModeChange('bike')}>
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="5.5" cy="17.5" r="3.5" /><circle cx="18.5" cy="17.5" r="3.5" /><path d="M15 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm-3 11.5V14l-3-3 4-3 2 3h2" /></svg>
          <span className="mode-label">Bike</span>
        </button>
        <button className={`mode-btn walk ${currentMode === 'foot' ? 'active' : ''}`} onClick={() => handleModeChange('foot')}>
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="1.5" /><path d="M13.5 8.5L15 12l-3 3-1.5 5M10.5 8.5L9 12l3 3 1 5M12 8.5V12" /></svg>
          <span className="mode-label">Walk</span>
        </button>
      </div>

      {/* TOP RIGHT CONTROLS */}
      <div className="top-right-controls">
        <button className="icon-btn glass" onClick={handleToggleDark} title="Toggle dark mode">
          {!isDark ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
          )}
        </button>
        <button className="icon-btn glass" onClick={handleLocateMe} title="Go to my location">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M12 2v4m0 12v4M2 12h4m12 0h4" /></svg>
        </button>
        <button className="icon-btn glass" onClick={handleClearRoute} title="Clear route">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>

      {/* ROUTE INFO PANEL */}
      <div className={`route-panel glass ${routeInfo ? 'visible' : ''}`}>
        {routeInfo && (
          <>
            <div className="route-header">
              <div className="route-stats">
                <div className="route-stat">
                  <span className="label">Distance</span>
                  <span className="value">{routeInfo.distance}</span>
                </div>
                <div className="route-stat">
                  <span className="label">Duration</span>
                  <span className="value duration">{routeInfo.duration}</span>
                </div>
              </div>
              <button className="route-close-btn" onClick={handleClearRoute} title="Close">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="route-instructions">
              {routeInfo.instructions.map((instr, i) => {
                const stepDist = instr.distance >= 1000 ? `${(instr.distance / 1000).toFixed(1)} km` : `${Math.round(instr.distance)} m`;
                return (
                  <div key={i} className="instruction-step">
                    <span className="step-num">{i + 1}</span>
                    <span className="step-text">{instr.text}</span>
                    <span className="step-dist">{stepDist}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </>
  );
}
