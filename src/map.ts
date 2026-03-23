// ====================================================
//  Mappy — Enhanced Map Application
//  Leaflet + GraphHopper + Nominatim (all open-source)
// ====================================================

const L = (window as any).L;
const polyline = (window as any).polyline;
export {};
declare global {
    interface Window {
        searchLocation: typeof searchLocation;
        setMode: typeof setMode;
        toggleDarkMode: typeof toggleDarkMode;
        locateMe: typeof locateMe;
        clearRoute: typeof clearRoute;
    }
}

// ---------- CONFIGURATION ----------
const GH_API_KEY = '57d9d0f6-832c-4037-9721-35b7bf7bc81c';

const TILE_LIGHT = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

const ROUTE_COLORS = {
    car: '#3b82f6',
    bike: '#22c55e',
    foot: '#f97316'
};
const GH_VEHICLES = {
    car: 'car',
    bike: 'bike',
    foot: 'foot'
};

// ---------- STATE ----------
let currentLatLng = null;
let userMarker = null;
let userCircle = null;
let destMarker = null;
let routeLine = null;
let zoomed = false;
let currentMode = 'car';
let isDark = localStorage.getItem('mappy-dark') === 'true';
let tileLayer = null;
let lastDestination = null;
let lastDestName = null;
let searchDebounce = null;
let isRouting = false;

// ---------- INITIALIZE MAP ----------
const map = L.map('map', {
    zoomControl: false
}).setView([20, 0], 2);

// Position zoom controls bottom-right so they don't clash with panels
L.control.zoom({ position: 'bottomright' }).addTo(map);

// Set initial tile layer
tileLayer = L.tileLayer(isDark ? TILE_DARK : TILE_LIGHT, {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

// Apply dark theme on load
if (isDark) {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.getElementById('iconSun').style.display = 'none';
    document.getElementById('iconMoon').style.display = 'block';
}

// Custom icon for user location (pulsing blue dot)
const userIcon = L.divIcon({
    className: 'user-marker',
    iconSize: [18, 18],
    iconAnchor: [9, 9]
});

// Custom icon for destination (red dot)
const destIcon = L.divIcon({
    className: 'dest-marker',
    iconSize: [14, 14],
    iconAnchor: [7, 7]
});


// ================================================================
//  GEOLOCATION — watch user position
// ================================================================
navigator.geolocation.watchPosition(onLocationSuccess, onLocationError, {
    enableHighAccuracy: true
});

function onLocationSuccess(pos) {
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    const accuracy = pos.coords.accuracy;
    currentLatLng = L.latLng(lat, lon);

    if (userMarker) map.removeLayer(userMarker);
    if (userCircle) map.removeLayer(userCircle);

    userMarker = L.marker(currentLatLng, { icon: userIcon })
        .addTo(map)
        .bindPopup('📍 You are here');

    userCircle = L.circle(currentLatLng, {
        radius: accuracy,
        color: '#3b82f6',
        fillColor: '#3b82f6',
        fillOpacity: 0.08,
        weight: 1.5
    }).addTo(map);

    if (!zoomed) {
        map.fitBounds(userCircle.getBounds());
        zoomed = true;
    }
}

function onLocationError(err) {
    if (err.code === 1) {
        alert('Please allow location access so Mappy can find your position.');
    } else {
        alert('Unable to fetch your location.');
    }
}


// ================================================================
//  ROUTING — draw route via GraphHopper
// ================================================================
async function drawRoute(start: any, end: any, destName?: string) {
    if (isRouting) return;
    isRouting = true;

    const spinner = document.getElementById('searchSpinner') as HTMLElement;
    const goBtn = document.getElementById('goBtn') as HTMLButtonElement;
    spinner.classList.add('active');
    goBtn.disabled = true;

    lastDestination = end;
    lastDestName = destName || `${end.lat.toFixed(4)}, ${end.lng.toFixed(4)}`;

    try {
        const vehicle = GH_VEHICLES[currentMode];
        const url =
            `https://graphhopper.com/api/1/route` +
            `?point=${start.lat},${start.lng}` +
            `&point=${end.lat},${end.lng}` +
            `&vehicle=${vehicle}` +
            `&points_encoded=true` +
            `&instructions=true` +
            `&locale=en` +
            `&key=${GH_API_KEY}`;

        const res = await fetch(url);
        const data = await res.json();

        if (!data.paths || !data.paths.length) {
            alert('No route found. Try a different transport mode or destination.');
            return;
        }

        const path = data.paths[0];

        // Decode polyline
        const coords = polyline.decode(path.points);

        // Remove old route
        if (routeLine) map.removeLayer(routeLine);

        // Draw new route
        routeLine = L.polyline(coords, {
            color: ROUTE_COLORS[currentMode],
            weight: 5,
            opacity: 0.85,
            smoothFactor: 1.2
        }).addTo(map);

        // Destination marker
        if (destMarker) map.removeLayer(destMarker);
        destMarker = L.marker(end, { icon: destIcon })
            .addTo(map)
            .bindPopup(`🏁 ${lastDestName}`)
            .openPopup();

        // Fit map to route
        map.fitBounds(routeLine.getBounds(), { padding: [60, 60] });

        // Populate route info panel
        showRouteInfo(path);

    } catch (err) {
        console.error('Routing error:', err);
        alert('Failed to fetch route. Please try again.');
    } finally {
        spinner.classList.remove('active');
        goBtn.disabled = false;
        isRouting = false;
    }
}

function showRouteInfo(path) {
    const panel = document.getElementById('routePanel');
    const distEl = document.getElementById('routeDistance');
    const durEl = document.getElementById('routeDuration');
    const instrEl = document.getElementById('routeInstructions');

    // Format distance
    const distKm = path.distance / 1000;
    distEl.textContent = distKm >= 1
        ? `${distKm.toFixed(1)} km`
        : `${Math.round(path.distance)} m`;

    // Format duration
    const totalSec = path.time / 1000;
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.round((totalSec % 3600) / 60);
    durEl.textContent = hrs > 0
        ? `${hrs}h ${mins}m`
        : `${mins} min`;

    // Build instructions
    instrEl.innerHTML = '';
    if (path.instructions && path.instructions.length) {
        path.instructions.forEach((instr, i) => {
            const stepDist = instr.distance >= 1000
                ? `${(instr.distance / 1000).toFixed(1)} km`
                : `${Math.round(instr.distance)} m`;

            const step = document.createElement('div');
            step.className = 'instruction-step';
            step.innerHTML = `
                <span class="step-num">${i + 1}</span>
                <span class="step-text">${instr.text}</span>
                <span class="step-dist">${stepDist}</span>
            `;
            instrEl.appendChild(step);
        });
    }

    // Show panel with animation
    panel.classList.add('visible');
}


// ================================================================
//  CLICK TO ROUTE
// ================================================================
map.on('click', function (e) {
    if (!currentLatLng) {
        alert('Waiting for your location…');
        return;
    }
    closeAutoComplete();
    drawRoute(currentLatLng, e.latlng);
});


// ================================================================
//  SEARCH — geocode with Nominatim
// ================================================================
async function searchLocation() {
    const input = document.getElementById('searchBox') as HTMLInputElement;
    const place = input.value.trim();

    if (!place) { alert('Please enter a location'); return; }
    if (!currentLatLng) { alert('Waiting for your location…'); return; }

    closeAutoComplete();

    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(place)}&limit=1`;

    try {
        const res = await fetch(url);
        const data = await res.json();

        if (!data.length) {
            alert('Location not found — try a different search');
            return;
        }

        const dest = {
            lat: parseFloat(data[0].lat),
            lng: parseFloat(data[0].lon)
        };

        drawRoute(currentLatLng, dest, data[0].display_name.split(',')[0]);
    } catch (err) {
        alert('Search failed. Check your connection.');
    }
}

// Enter key support
document.getElementById('searchBox').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') searchLocation();
});


// ================================================================
//  AUTOCOMPLETE — debounced Nominatim lookup
// ================================================================
document.getElementById('searchBox')!.addEventListener('input', function (this: HTMLInputElement) {
    clearTimeout(searchDebounce);
    const q = this.value.trim();
    if (q.length < 3) { closeAutoComplete(); return; }

    searchDebounce = setTimeout(() => fetchSuggestions(q), 300);
});

async function fetchSuggestions(query) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        renderSuggestions(data);
    } catch { /* silently fail */ }
}

function renderSuggestions(results) {
    const list = document.getElementById('autocompleteList');
    list.innerHTML = '';

    results.forEach(r => {
        const li = document.createElement('li');
        const parts = r.display_name.split(',');
        const name = parts[0].trim();
        const region = parts.slice(1, 3).join(',').trim();

        li.innerHTML = `
            <svg class="ac-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            <span class="ac-name">${escapeHtml(name)}</span>
            <span class="ac-region">${escapeHtml(region)}</span>
        `;
        li.addEventListener('click', () => {
            (document.getElementById('searchBox') as HTMLInputElement).value = name;
            closeAutoComplete();
            if (!currentLatLng) { alert('Waiting for your location…'); return; }
            const dest = { lat: parseFloat(r.lat), lng: parseFloat(r.lon) };
            drawRoute(currentLatLng, dest, name);
        });
        list.appendChild(li);
    });
}

function closeAutoComplete() {
    document.getElementById('autocompleteList').innerHTML = '';
}

// Close autocomplete when clicking elsewhere
document.addEventListener('click', (e) => {
    if (!document.getElementById('searchPanel')!.contains(e.target as Node)) {
        closeAutoComplete();
    }
});


// ================================================================
//  TRANSPORT MODE
// ================================================================
function setMode(mode, btn) {
    currentMode = mode;

    // Update active button
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Re-draw route if one exists
    if (lastDestination && currentLatLng) {
        drawRoute(currentLatLng, lastDestination, lastDestName);
    }
}


// ================================================================
//  DARK MODE
// ================================================================
function toggleDarkMode() {
    isDark = !isDark;
    localStorage.setItem('mappy-dark', String(isDark));

    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : '');

    // Swap tile layer
    map.removeLayer(tileLayer);
    tileLayer = L.tileLayer(isDark ? TILE_DARK : TILE_LIGHT, {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap'
    }).addTo(map);

    // Swap icon
    document.getElementById('iconSun').style.display = isDark ? 'none' : 'block';
    document.getElementById('iconMoon').style.display = isDark ? 'block' : 'none';
}


// ================================================================
//  LOCATE ME
// ================================================================
function locateMe() {
    if (currentLatLng) {
        map.flyTo(currentLatLng, 16, { duration: 1.2 });
    } else {
        alert('Still acquiring your location…');
    }
}


// ================================================================
//  CLEAR ROUTE
// ================================================================
function clearRoute() {
    if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
    if (destMarker) { map.removeLayer(destMarker); destMarker = null; }

    lastDestination = null;
    lastDestName = null;

    // Hide route panel
    document.getElementById('routePanel').classList.remove('visible');
    document.getElementById('routeInstructions').innerHTML = '';
    document.getElementById('routeDistance').textContent = '—';
    document.getElementById('routeDuration').textContent = '—';
}


// ================================================================
//  UTILITIES
// ================================================================
function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

window.searchLocation = searchLocation;
window.setMode = setMode;
window.toggleDarkMode = toggleDarkMode;
window.locateMe = locateMe;
window.clearRoute = clearRoute;