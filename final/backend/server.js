const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

// ==========================================
// 1. LOAD INDORE IPC CRIME DATASET
// ==========================================
let indoreCrimes = [];
try {
    const rawData = fs.readFileSync('./indore_crimes.json');
    indoreCrimes = JSON.parse(rawData);
    console.log(`✅ Loaded ${indoreCrimes.length} historical crime records for Indore.`);
} catch (err) {
    console.error("⚠️ Warning: Could not load indore_crimes.json. Ensure the file exists in the backend folder.");
}

// REAL Indore Safe Havens
const safeHavens = [
    { name: "Palasia Police Station", lat: 22.7240, lng: 75.8850, radiusKm: 0.8, safetyBonus: 15 },
    { name: "MY Hospital", lat: 22.7150, lng: 75.8650, radiusKm: 1.0, safetyBonus: 10 },
    { name: "Vijay Nagar Police Station", lat: 22.7550, lng: 75.8950, radiusKm: 0.8, safetyBonus: 15 }
];

// ==========================================
// 2. HELPER & TRANSLATOR FUNCTIONS
// ==========================================

function getCrimeSeverity(crime) {
    if (crime.act302 === 1) return 10; 
    if (crime.act363 === 1) return 9;  
    if (crime.act323 === 1) return 7;  
    if (crime.act379 === 1) return 5;  
    if (crime.act279 === 1) return 4;  
    return 3; 
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + 
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
              Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

function isWithinBoundingBox(lat1, lon1, lat2, lon2, thresholdDegrees = 0.015) {
    return Math.abs(lat1 - lat2) <= thresholdDegrees && Math.abs(lon1 - lon2) <= thresholdDegrees;
}

// --- UPDATED: IST Time Zone & Custom Multipliers ---
function getTimeMultiplier() {
    // Lock the timezone to India (IST) so server location doesn't matter
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        hour: 'numeric',
        hourCycle: 'h23' // Returns 0-23 format
    });
    
    const hour = parseInt(formatter.format(new Date()), 10);

    if (hour >= 19 && hour < 21) {
        return 1.1; // 7 PM to 9 PM
    } else if (hour >= 21 && hour <= 23) {
        return 1.2; // 9 PM to 12 AM
    } else if (hour >= 0 && hour < 4) {
        return 1.3; // 12 AM to 4 AM
    } else {
        return 0.5; // 4 AM to 7 PM (Daytime - lower baseline risk)
    }
}

// ==========================================
// 3. THE SAFETY ALGORITHM
// ==========================================
function calculateSafetyScore(route) {
    let penalty = 0;
    let pathFactors = { crimeHits: 0, highestSeverityHit: 0, narrowRoads: 0, wideRoads: 0, safeHavens: 0 };
    const timeMultiplier = getTimeMultiplier();
    
    const coordinates = route.geometry.coordinates; 

    coordinates.forEach(coord => {
        const [lng, lat] = coord;
        
        indoreCrimes.forEach(crime => {
            if (isWithinBoundingBox(lat, lng, crime.latitude, crime.longitude)) {
                const distance = calculateDistance(lat, lng, crime.latitude, crime.longitude);
                if (distance <= 0.4) { 
                    const severity = getCrimeSeverity(crime);
                    // Penalty scales strictly by your new time multiplier rules
                    penalty += (severity * 2) * timeMultiplier;
                    pathFactors.crimeHits++;
                    if (severity > pathFactors.highestSeverityHit) pathFactors.highestSeverityHit = severity;
                }
            }
        });

        safeHavens.forEach(haven => {
            if (isWithinBoundingBox(lat, lng, haven.lat, haven.lng)) {
                const distance = calculateDistance(lat, lng, haven.lat, haven.lng);
                if (distance <= haven.radiusKm) {
                    penalty -= haven.safetyBonus;
                    pathFactors.safeHavens++;
                }
            }
        });
    });

    if (route.legs && route.legs[0] && route.legs[0].steps) {
        route.legs[0].steps.forEach(step => {
            if (step.maneuver && step.maneuver.type === "turn") penalty += 1; 
            if (step.duration > 0 && step.distance > 50) { 
                const speedKmh = (step.distance / step.duration) * 3.6;
                // Apply time multiplier to narrow road penalties too! (Darker/Narrower at night is worse)
                if (speedKmh < 30) { 
                    penalty += (4 * timeMultiplier); 
                    pathFactors.narrowRoads++; 
                } 
                else if (speedKmh > 50) { 
                    penalty -= 3; 
                    pathFactors.wideRoads++; 
                }
            }
        });
    }

    // Add this logic inside your calculateSafetyScore function in server.js
// Add this logic inside your calculateSafetyScore function in server.js

function calculateSafetyScore(route) {
    let penalty = 0;
    let pathFactors = { crimeHits: 0, lightHits: 0, darknessPenalty: 0 };
    const timeMultiplier = getTimeMultiplier(); // 1.1x to 1.3x at night
    const isNightTime = timeMultiplier > 1.0; 

    const coordinates = route.geometry.coordinates; 

    coordinates.forEach((coord, index) => {
        const [lng, lat] = coord;
        let areaHasLight = false;

        // Check for Street Lights near this coordinate
        indoreLighting.forEach(light => {
            const lLat = light.lat || light.latitude;
            const lLng = light.lng || light.longitude;
            
            if (isWithinBoundingBox(lat, lng, lLat, lLng, 0.003)) { // 300m range
                if (calculateDistance(lat, lng, lLat, lLng) <= 0.15) {
                    areaHasLight = true;
                    pathFactors.lightHits++;
                }
            }
        });

        // --- THE DARK PATH LOGIC ---
        // If it's night and no light was found within 150m of this coordinate
        if (isNightTime && !areaHasLight) {
            // Every "dark" coordinate adds a small penalty. 
            // On a long road with no lights, this builds up and pushes the route away.
            penalty += 15 * timeMultiplier; 
            pathFactors.darknessPenalty++;
        }

        // Crime penalty logic remains here...
        indoreCrimes.forEach(crime => {
            if (isWithinBoundingBox(lat, lng, crime.latitude, crime.longitude)) {
                if (calculateDistance(lat, lng, crime.latitude, crime.longitude) <= 0.4) {
                    penalty += (getCrimeSeverity(crime) * 5) * timeMultiplier;
                    pathFactors.crimeHits++;
                }
            }
        });
    });

    // Final Scale
    let scaledScore = Math.max(penalty, 0) / 1000;
    
    let summary = "Standard Path";
    if (isNightTime && pathFactors.darknessPenalty > 20) {
        summary = "Warning: This path has several unlit/dark sections.";
    } else if (isNightTime && pathFactors.lightHits > 50) {
        summary = "Safest: Route is well-lit and avoids dark zones.";
    }

    return { totalPenalty: parseFloat(scaledScore.toFixed(3)), summary: summary };
}

    // Dynamic Summary
    let summary = "Standard Route";
    if (pathFactors.highestSeverityHit >= 7) {
        summary = "Warning: Avoids historically severe crime zones.";
    } else if (pathFactors.crimeHits > 5) {
        summary = "Avoids cluster of historical petty crime zones.";
    } else if (pathFactors.safeHavens > 0) {
        summary = "Secure Path: Passes near major Police Station or Hospital.";
    } else if (pathFactors.wideRoads > pathFactors.narrowRoads) {
        summary = "Very Safe: Minimal crime history, mostly main roads.";
    }

    // --- DIVIDE BY 1000 & KEEP DECIMALS ---
    let scaledScore = Math.max(penalty, 0) / 1000;
    let finalScore = parseFloat(scaledScore.toFixed(3));

    return { totalPenalty: finalScore, summary: summary };
}

// ==========================================
// 4. API ENDPOINT
// ==========================================
app.get('/api/routes', async (req, res) => {
    const { startLng, startLat, endLng, endLat } = req.query;

    if (!startLng || !startLat || !endLng || !endLat) {
        return res.status(400).json({ error: "Missing start or end coordinates" });
    }

    try {
        const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${endLng},${endLat}?alternatives=3&geometries=geojson&overview=full&steps=true`;
        const response = await axios.get(osrmUrl);
        const routes = response.data.routes;

        if (!routes || routes.length === 0) return res.status(404).json({ error: "No routes found" });

        const processedRoutes = routes.map(route => {
            const safetyData = calculateSafetyScore(route);
            return {
                ...route,
                safetyPenalty: safetyData.totalPenalty,
                safetySummary: safetyData.summary
            };
        });

        const shortestRoute = [...processedRoutes].sort((a, b) => a.distance - b.distance)[0];
        const safestRoute = [...processedRoutes].sort((a, b) => a.safetyPenalty - b.safetyPenalty)[0];

        res.json({ shortestRoute, safestRoute });

    } catch (error) {
        console.error("OSRM Error:", error.message);
        res.status(500).json({ error: "Failed to fetch routes" });
    }
});

// Endpoint to serve all crime points for the Heatmap
app.get('/api/crimes-heatmap', (req, res) => {
    try {
        const rawData = fs.readFileSync('./indore_crimes.json', 'utf8');
        const crimes = JSON.parse(rawData);
        
        // Ensure every point is an array of [Number, Number, Number]
        const heatData = crimes.map(c => [
            parseFloat(c.latitude), 
            parseFloat(c.longitude), 
            0.6 // Intensity (0 to 1)
        ]);

        res.json(heatData);
    } catch (err) {
        console.error("Heatmap Data Error:", err);
        res.status(500).json([]);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🛡️ SafeRoute Backend running on port ${PORT}`);
    console.log(`⏰ Current Multiplier in IST: x${getTimeMultiplier()}`);
});