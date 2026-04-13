// ===== Mappy — Territory Conquest Game =====
import React, { useEffect, useRef, useState } from 'react';
import { GameState, GamePhase } from './types';
import { GameEngine } from './GameEngine';
import SetupPhase from './SetupPhase';
import GameHUD from './GameHUD';

const L = (window as any).L;

// ── Clean Map Tiles (no labels) ──
const TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png';
const TILE_ATTR = '&copy; OpenStreetMap &copy; CARTO';

export default function App() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const engineRef = useRef<GameEngine | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadingMsg, setLoadingMsg] = useState('Loading map data…');
  const [geoData, setGeoData] = useState<any>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [phase, setPhase] = useState<GamePhase>('setup');

  // ── Initialize Leaflet Map ──
  useEffect(() => {
    if (!mapContainer.current || mapInstance.current) return;

    mapInstance.current = L.map(mapContainer.current, {
      zoomControl: false,
      attributionControl: false,
      minZoom: 2,
      maxZoom: 8,
      worldCopyJump: true,
    }).setView([20, 0], 3);

    // Clean dark tile layer — NO labels
    L.tileLayer(TILE_URL, {
      maxZoom: 19,
      attribution: TILE_ATTR,
    }).addTo(mapInstance.current);

    // Zoom control bottom-right
    L.control.zoom({ position: 'bottomright' }).addTo(mapInstance.current);

    // Small attribution
    L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(mapInstance.current);

    return () => {
      mapInstance.current?.remove();
      mapInstance.current = null;
    };
  }, []);

  // ── Initialize Game Engine & Load GeoJSON ──
  useEffect(() => {
    const engine = new GameEngine((state) => {
      setGameState(state);
      setPhase(state.phase);
    });
    engineRef.current = engine;

    setLoading(true);
    setLoadingMsg('Loading country boundaries…');

    engine.loadGeoData()
      .then((data) => {
        setGeoData(data);
        setLoadingMsg('Computing adjacency…');
        // Small delay to let UI update
        setTimeout(() => {
          setLoading(false);
          setGameState({ ...engine.state });
        }, 300);
      })
      .catch(() => {
        setLoadingMsg('Failed to load data. Please refresh.');
      });

    return () => {
      engine.stop();
    };
  }, []);

  // ── Handle Setup Complete → Start Game ──
  const handleStartGame = (name: string, color: string, provinceIds: Set<string>) => {
    const engine = engineRef.current;
    if (!engine) return;

    setLoadingMsg('Generating AI opponents…');
    setLoading(true);

    setTimeout(() => {
      engine.setPlayerNation(name, color, provinceIds);
      engine.startGame();
      setLoading(false);
    }, 500);
  };

  return (
    <>
      {/* Map Container */}
      <div id="map" ref={mapContainer} />

      {/* Loading Overlay */}
      {loading && (
        <div className="loading-overlay">
          <div className="loading-card glass">
            <div className="loading-spinner" />
            <span className="loading-text">{loadingMsg}</span>
          </div>
        </div>
      )}

      {/* Setup Phase */}
      {!loading && phase === 'setup' && geoData && (
        <SetupPhase
          mapInstance={mapInstance}
          geoData={geoData}
          onStartGame={handleStartGame}
        />
      )}

      {/* Game Phase */}
      {!loading && (phase === 'playing' || phase === 'victory' || phase === 'defeat') && gameState && engineRef.current && (
        <GameHUD
          mapInstance={mapInstance}
          gameState={gameState}
          engine={engineRef.current}
          geoData={geoData}
        />
      )}
    </>
  );
}
