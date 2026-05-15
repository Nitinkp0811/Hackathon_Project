// Premium Free Map Tiles from CartoDB
const BASE_API = 'http://172.16.54.15:3000/api';
const BACKEND_URL = 'http://localhost:3000/api/routes';
let map, userMarker, destMarker;
let userLocation = null;
let routeLayers = [];

let crimeHeatLayer;
let showHeatmap = false;

const darkMapUrl = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const lightMapUrl = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
let currentTileLayer;


// Initialize Map
function initMap(lat, lng) {
    map = L.map('map').setView([lat, lng], 13);
    
    // Check local storage for saved theme, default to dark
    const isLightMode = localStorage.getItem('theme') === 'light';
    const initialTileUrl = isLightMode ? lightMapUrl : darkMapUrl;
    
    if (isLightMode) {
        document.body.classList.add('light-mode');
        document.getElementById('theme-toggle').innerText = '🌙'; // Show moon icon if in light mode
    }

    currentTileLayer = L.tileLayer(initialTileUrl, {
        maxZoom: 19,
        attribution: '© OpenStreetMap & CartoDB'
    }).addTo(map);

    userMarker = L.marker([lat, lng]).addTo(map).bindPopup("You").openPopup();
}

// Get Geolocation
navigator.geolocation.getCurrentPosition((pos) => {
    userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    initMap(userLocation.lat, userLocation.lng);
    document.getElementById('status-text').innerText = "Ready to navigate.";
});

// Search functionality remains the same...
document.getElementById('search-btn').addEventListener('click', async () => {
    const query = document.getElementById('destination-input').value;
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`);
    const data = await res.json();
    if (data.length > 0) {
        selectDestination(data[0].lat, data[0].lon, data[0].display_name);
    }
});

async function selectDestination(lat, lng, name) {
    document.getElementById('status-text').innerText = "Calculating routes...";
    const destLat = parseFloat(lat);
    const destLng = parseFloat(lng);

    if (destMarker) map.removeLayer(destMarker);
    destMarker = L.marker([destLat, destLng]).addTo(map);

    try {
        const routeRes = await fetch(`${BACKEND_URL}?startLng=${userLocation.lng}&startLat=${userLocation.lat}&endLng=${destLng}&endLat=${destLat}`);
        const routesData = await routeRes.json();

        // Pass the full route objects to show distances
        drawRoutes(routesData.safestRoute, routesData.shortestRoute);
        document.getElementById('status-text').innerText = "Route Found!";
        document.getElementById('route-info').classList.remove('hidden');

    } catch (err) {
        document.getElementById('status-text').innerText = "Error fetching routes.";
    }

    document.getElementById('route-info').classList.remove('hidden');

    document.getElementById('autocomplete-results').innerHTML = '';
}

// Draw Routes on Leaflet
// Draw Routes and Update UI Stats
function drawRoutes(safest, shortest) {
    // Clear old routes
    routeLayers.forEach(layer => map.removeLayer(layer));
    routeLayers = [];

    const isSameRoute = safest.distance === shortest.distance;

    // 1. Calculations: Distance (km) & Time (minutes)
    const safeDistKm = (safest.distance / 1000).toFixed(2);
    const shortDistKm = (shortest.distance / 1000).toFixed(2);
    
    const safeTimeMin = Math.round(safest.duration / 60);
    const shortTimeMin = Math.round(shortest.duration / 60);

    // 2. Grab UI Elements
    const shortStatItem = document.getElementById('short-stat-item');
    const safeLabel = document.getElementById('safe-label');

    // 3. Update SAFEST Route UI
    document.getElementById('safe-dist').innerText = safeDistKm;
    document.getElementById('safe-time').innerText = safeTimeMin;
    document.getElementById('safe-score').innerText = safest.safetyPenalty; // Inject Score
    document.getElementById('safe-reason').innerText = `✓ ${safest.safetySummary}`;

    if (isSameRoute) {
        // --- SCENARIO A: ROUTES ARE THE SAME ---
        safeLabel.innerText = "Safest & Shortest Route:";
        shortStatItem.style.display = 'none';

        const coords = safest.geometry.coordinates.map(c => [c[1], c[0]]);
        const line = L.polyline(coords, { color: '#4ade80', weight: 6, opacity: 0.9 }).addTo(map);
        routeLayers.push(line);
        map.fitBounds(line.getBounds(), { padding: [50, 50] });

    } else {
        // --- SCENARIO B: ROUTES ARE DIFFERENT ---
        safeLabel.innerText = "Safest Path:";
        shortStatItem.style.display = 'flex';

        // Update SHORTEST Route UI
        document.getElementById('short-dist').innerText = shortDistKm;
        document.getElementById('short-time').innerText = shortTimeMin;
        document.getElementById('short-score').innerText = shortest.safetyPenalty; // Inject Score

        // Draw Shortest Path FIRST (Dashed Gray)
        const shortCoords = shortest.geometry.coordinates.map(c => [c[1], c[0]]);
        const shortLine = L.polyline(shortCoords, { 
            color: '#94a3b8', weight: 4, dashArray: '10, 10', opacity: 0.8 
        }).addTo(map);
        routeLayers.push(shortLine);

        // Draw Safest Path SECOND (Solid Green)
        const safeCoords = safest.geometry.coordinates.map(c => [c[1], c[0]]);
        const safeLine = L.polyline(safeCoords, { 
            color: '#4ade80', weight: 6, opacity: 0.9 
        }).addTo(map);
        routeLayers.push(safeLine);

        const group = new L.featureGroup([shortLine, safeLine]);
        map.fitBounds(group.getBounds(), { padding: [50, 50] });
    }
}

// --- HEATMAP SYSTEM ---
let heatLayer = null;

async function toggleHeatmap() {
    const btn = document.getElementById('heatmap-toggle');
    console.log("Heatmap button triggered!");

    // 1. If heatmap is already on, turn it off
    if (heatLayer) {
        map.removeLayer(heatLayer);
        heatLayer = null;
        btn.style.background = "transparent";
        console.log("Heatmap removed.");
        return;
    }

    // 2. Otherwise, fetch data and turn it on
    try {
        console.log("Fetching heatmap data from:", `${BASE_API}/crimes-heatmap`);
        const response = await fetch(`${BASE_API}/crimes-heatmap`);
        const data = await response.json();

        if (!data || data.length === 0) {
            console.error("Backend returned 0 points. Check indore_crimes.json");
            alert("No crime data found for heatmap.");
            return;
        }

        console.log(`Successfully received ${data.length} points.`);

        // 3. Create the layer using the global L.heatLayer
        heatLayer = L.heatLayer(data, {
            radius: 25,
            blur: 15,
            maxZoom: 17,
            gradient: { 0.4: 'blue', 0.6: 'cyan', 0.8: 'yellow', 1.0: 'red' }
        }).addTo(map);

        btn.style.background = "#ef4444"; // Turn button red when active
        console.log("Heatmap added to map.");

    } catch (err) {
        console.error("CRITICAL HEATMAP ERROR:", err);
        alert("Failed to load heatmap. Check browser console (F12) for details.");
    }
}

// --- ENSURE EVENT LISTENERS ARE ATTACHED ---
document.addEventListener('DOMContentLoaded', () => {
    const heatBtn = document.getElementById('heatmap-toggle');
    if (heatBtn) {
        heatBtn.addEventListener('click', toggleHeatmap);
        console.log("Heatmap event listener attached successfully.");
    } else {
        console.error("Could not find button with ID 'heatmap-toggle'!");
    }
});
// Theme Toggle Logic
document.getElementById('theme-toggle').addEventListener('click', () => {
    const isLight = document.body.classList.toggle('light-mode');
    const toggleBtn = document.getElementById('theme-toggle');
    
    if (isLight) {
        // Switch to Light Mode
        localStorage.setItem('theme', 'light');
        toggleBtn.innerText = '🌙';
        
        // Swap map tiles
        map.removeLayer(currentTileLayer);
        currentTileLayer = L.tileLayer(lightMapUrl, { maxZoom: 19 }).addTo(map);
    } else {
        // Switch to Dark Mode
        localStorage.setItem('theme', 'dark');
        toggleBtn.innerText = '☀️';
        
        // Swap map tiles
        map.removeLayer(currentTileLayer);
        currentTileLayer = L.tileLayer(darkMapUrl, { maxZoom: 19 }).addTo(map);
    }
});

async function showLightingZones() {
    try {
        const res = await fetch(`${BASE_API}/lighting`); // Create an endpoint for lighting JSON
        const data = await res.json();
        const lightPoints = data.map(l => [l.lat, l.lng, 0.5]);
        
        // Green heatmap for lights
        L.heatLayer(lightPoints, {
            radius: 20,
            blur: 15,
            gradient: { 0.4: 'green', 1: 'lime' }
        }).addTo(map);
    } catch (e) { console.log("Lighting heatmap failed."); }
}

// ==========================================
// 🚨 SOS EMERGENCY SYSTEM
// ==========================================
document.getElementById('sos-btn').addEventListener('click', () => {
    if (!userLocation) {
        alert("Acquiring location...");
        return;
    }

    const emergencyNumber = "919522120811"; // Note: WhatsApp requires country code (91)
    const mapsLink = `https://maps.google.com/?q=${userLocation.lat},${userLocation.lng}`;
    const message = `🚨 SOS EMERGENCY! I need help. My live location: ${mapsLink}`;

    // 1. Trigger WhatsApp (Opens App on mobile, Web on laptop)
    const whatsappUrl = `https://wa.me/${emergencyNumber}?text=${encodeURIComponent(message)}`;
    
    // We use window.open for WhatsApp so it opens in a new tab/app
    window.open(whatsappUrl, '_blank');

    // 2. Trigger SMS (Optional fallback)
    // const smsUri = `sms:${emergencyNumber}?body=${encodeURIComponent(message)}`;
    // window.location.href = smsUri;
});