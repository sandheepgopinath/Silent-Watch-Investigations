import { db, doc, getDoc, setDoc, updateDoc, serverTimestamp, logoutUser, monitorAuthState } from './auth.js';

// Configuration
const CONFIG = {
    locations: {
        kalamserry: { lat: 10.0518, lng: 76.3333, label: "Kalamassery Junction" },
        kakkanad: { lat: 10.0159, lng: 76.3419, label: "Kakkanad Outskirts (Signal Origin)" }
    },
    audio: {
        alert: document.getElementById('sfx-alert'),
        static: document.getElementById('sfx-static')
    }
};

// State
let state = {
    stage: 'IDLE', // IDLE, ACTIVE_SHIFT, SOS_RECEIVED, UNIT_DISPATCHED, SCENARIO_1_COMPLETE, CALL_INCOMING, CALL_ACTIVE, TRAP_ACTIVE
    currentUser: null,
    scenario1Resolved: false,
    scenario2Started: false,
    callCount: 0,
    s1SubState: 'ARRIVED' // ARRIVED, CROWD_CONTROL, DETAILS, READY_TO_CLOSE
};

// Map
let map;
let markers = {};

document.addEventListener('DOMContentLoaded', () => {
    // Initialize Event Listeners immediately
    const startBtn = document.getElementById('start-shift-btn');
    if (startBtn) {
        console.log("Attaching listener to start-shift-btn (Early)");
        startBtn.addEventListener('click', (e) => {
            console.log("Start Shift Clicked");
            startShift();
        });
    } else {
        console.error("start-shift-btn not found in DOM");
    }

    // Auth Check
    monitorAuthState(
        (user) => {
            console.log("Auth State: User detected", user.uid);
            state.currentUser = user;
            updateUserProfile(user); // Update Sidebar Profile
            initSystem();
            initSidebar(); // Initialize Sidebar
            checkProgress(); // Restore State
        },
        () => {
            console.warn("Auth State: No user");
            window.location.replace('index.html');
        }
    );
});

function updateUserProfile(user) {
    const profileName = document.querySelector('.user-info .name');
    const avatar = document.querySelector('.avatar');

    if (user.displayName && profileName) {
        profileName.textContent = user.displayName;
    }

    if (user.photoURL && avatar) {
        avatar.style.backgroundImage = `url('${user.photoURL}')`;
        avatar.style.backgroundSize = 'cover';
    }
}

function initSystem() {
    // Clock
    setInterval(updateClock, 1000);

    // Map Init (Leaflet)
    initMap();

    // Event Listeners regarding Chat (Start Shift moved to DOMContentLoaded)
    document.getElementById('chat-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendPlayerMessage();
    });
    document.getElementById('chat-send').addEventListener('click', sendPlayerMessage);
}

function initSidebar() {
    const menuToggle = document.getElementById('menu-toggle');
    const closeMenu = document.getElementById('close-menu');
    const sidebar = document.getElementById('sidebar');
    const profileToggle = document.getElementById('profile-toggle');
    const profileWrapper = document.querySelector('.user-profile-wrapper');
    const logoutBtn = document.getElementById('logout-btn');

    if (menuToggle && sidebar) {
        menuToggle.addEventListener('click', () => {
            sidebar.classList.add('active');
        });
    }

    if (closeMenu && sidebar) {
        closeMenu.addEventListener('click', () => {
            sidebar.classList.remove('active');
        });
    }

    if (profileToggle && profileWrapper) {
        profileToggle.addEventListener('click', () => {
            profileWrapper.classList.toggle('open');
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            logoutUser();
        });
    }
}

function updateClock() {
    const now = new Date();
    document.getElementById('clock').textContent = now.toLocaleTimeString('en-US', { hour12: false });
}

function initMap() {
    // Centered on Cochin
    map = L.map('map', {
        zoomControl: false,
        attributionControl: false
    }).setView([10.02, 76.32], 12);

    // Dark styled tiles (CartoDB Dark Matter)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19
    }).addTo(map);
}

// Custom Icon definition
const pinIcon = L.divIcon({
    className: 'custom-pin',
    html: '<div class="pin-inner"></div>',
    iconSize: [20, 20],
    iconAnchor: [10, 10]
});



// --- SCENARIO 1: ACCIDENT ---

// --- SCENARIO 1: ACCIDENT ---

function triggerScenario1() {
    state.stage = 'SOS_RECEIVED';
    playAlert();

    // Verify progress
    updateVoicelessProgress({ sosBeaconShown: true });

    // Chat is offline by default in HTML now

    // Create Alert Card
    const callList = document.getElementById('calls-list');
    callList.innerHTML = '';

    const alertCard = document.createElement('div');
    alertCard.className = 'call-card sos active';
    alertCard.id = 'alert-s1';
    alertCard.innerHTML = `
        <div class="call-header">
            <span>SOS BEACON</span>
            <span>00:00:01</span>
        </div>
        <div class="call-source">CRASH DETECTED</div>
        <div style="color: var(--accent-amber); margin: 5px 0;">Signal Triangulated</div>
        <div class="call-actions">
            <button class="action-btn" onclick="window.trackLocation('kalamserry')">TRACK LOCATION</button>
        </div>
    `;
    callList.appendChild(alertCard);
}

// Global scope for HTML button access
window.trackLocation = (locKey) => {
    const loc = CONFIG.locations[locKey];
    if (!loc) return;

    // Pan to map
    map.flyTo([loc.lat, loc.lng], 15, { duration: 2 });

    // Auto-scroll for mobile
    if (window.innerWidth <= 768) {
        document.getElementById('map-container').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // Add marker
    if (!markers[locKey]) {
        markers[locKey] = L.marker([loc.lat, loc.lng], { icon: pinIcon }).addTo(map)
            .bindPopup(loc.label).openPopup();
    }

    if (locKey === 'kalamserry' && state.stage === 'SOS_RECEIVED') {
        updateVoicelessProgress({ trackingStarted: true });
        const card = document.getElementById('alert-s1');
        card.querySelector('.call-actions').innerHTML = `
            <button class="action-btn urgent" onclick="window.findNearestUnit()">FIND NEAREST UNIT</button>
        `;
    }

    if (locKey === 'kakkanad' && (state.stage === 'CALL_INCOMING' || state.stage === 'CALL_ACTIVE')) {
        const card = document.getElementById('alert-s2');
        if (card) {
            card.querySelector('.call-actions').innerHTML = `
                <button class="action-btn urgent" onclick="window.dispatchUnit('kakkanad')">DISPATCH UNIT</button>
             `;
        }
    }
};

let carMarker = null;

window.findNearestUnit = () => {
    updateVoicelessProgress({ unitSearchStarted: true });
    showToast("Scanning for nearby units...", "info");
    const card = document.getElementById('alert-s1');
    card.querySelector('.call-actions').innerHTML = `<span style="color:var(--text-secondary); font-size: 0.8rem;">SCANNING...</span>`;

    setTimeout(() => {
        // Unit Found - Animate
        updateVoicelessProgress({ unitFound: true });
        setChatOnline(); // Enable UI
        enableChat(); // Enable Input immediately
        showToast("UNIT BETA-1 IDENTIFIED", "success");

        // Start point (arbitrary offset)
        const startLat = 10.0570;
        const startLng = 76.3280;
        const endLat = CONFIG.locations.kalamserry.lat;
        const endLng = CONFIG.locations.kalamserry.lng;

        // Custom Car Icon
        const carIcon = L.divIcon({
            className: 'custom-pin',
            html: '<div style="font-size: 20px; color: var(--accent-cyan);"><i class="fas fa-car"></i></div>',
            iconSize: [25, 25],
            iconAnchor: [12, 12]
        });

        carMarker = L.marker([startLat, startLng], { icon: carIcon }).addTo(map);

        // Initial Message
        addChatMessage("Beta-1", "Dispatch, we have your location. ETA 20 seconds. We are en route.");

        // Animation Loop (20s)
        const duration = 20000;
        const startTime = Date.now();

        function animate() {
            const now = Date.now();
            const progress = Math.min((now - startTime) / duration, 1);

            const lat = startLat + (endLat - startLat) * progress;
            const lng = startLng + (endLng - startLng) * progress;

            carMarker.setLatLng([lat, lng]);

            if (progress < 1) {
                requestAnimationFrame(animate);
                card.querySelector('.call-actions button').innerText = `ETA: ${Math.ceil(20 - (progress * 20))}s`;
            } else {
                // Arrival
                state.stage = 'UNIT_DISPATCHED';
                updateVoicelessProgress({ unitArrived: true });
                card.classList.remove('active');
                card.querySelector('.call-actions').innerHTML = `<span style="color:var(--accent-cyan)">UNIT ON SITE</span>`;

                // Enable Chat (Ensure it stays enabled)
                enableChat();
                addChatMessage("Beta-1", "Dispatch, we have arrived at the coordinates. It's a collision.");
                setTimeout(() => {
                    addChatMessage("Beta-1", "I see a crowd gathering around the vehicles. It looks tense. Should I intervene directly or hold back?");
                }, 2000);
            }
        }
        requestAnimationFrame(animate);

    }, 2000); // 2s scanning delay
};

// Reused for S2
window.dispatchUnit = (locKey) => {
    if (locKey === 'kakkanad') {
        state.stage = 'UNIT_DISPATCHED_S2';
        showToast("UNIT BETA-1 REDIRECTED", "warning");

        stopCall();

        const card = document.getElementById('alert-s2');
        if (card) {
            card.classList.remove('active');
            card.querySelector('.call-actions').innerHTML = `<span style="color:var(--accent-cyan)">UNIT INVESTIGATING</span>`;
        }

        addChatMessage("Beta-1", "Copy that Control. Diverting to Kakkanad coordinates. It's... pretty isolated out there.");
        setTimeout(startScenario2Sequence, 6000);
    }
};

function disableChat(reason) {
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send');
    input.disabled = true;
    sendBtn.disabled = true;
    input.placeholder = reason || "Connection unavailable";
}

function enableChat() {
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send');
    input.disabled = false;
    sendBtn.disabled = false;
    input.placeholder = "Transmit instructions...";
    input.focus();
}

function setChatOnline() {
    document.getElementById('offline-overlay').style.display = 'none';
    document.getElementById('chat-messages').style.display = 'flex';
    document.getElementById('chat-header-status').style.display = 'block';
}

function sendPlayerMessage() {
    const input = document.getElementById('chat-input');
    const msg = input.value.trim();
    if (!msg) return;

    addChatMessage("Control", msg, true);
    input.value = '';

    handleAIResponse(msg);
}

function handleAIResponse(playerMsg) {
    playerMsg = playerMsg.toLowerCase();

    // Scenario 1 Logic - Dependent AI
    if (state.stage === 'UNIT_DISPATCHED' && !state.scenario1Resolved) {
        setTimeout(() => {
            // SCENARIO 1 STATE MACHINE
            const unitMsgs = document.querySelectorAll('.message.unit');
            const lastMsg = unitMsgs.length > 0 ? unitMsgs[unitMsgs.length - 1].textContent : '';

            // 1. ARRIVED -> CROWD_CONTROL
            if (state.s1SubState === 'ARRIVED') {
                if (playerMsg.includes('intervene') || playerMsg.includes('stop') || playerMsg.includes('separate') || playerMsg.includes('handle')) {
                    addChatMessage("Beta-1", "Copy that. Stepping out to intervene. Separating the two drivers now. Stand by.");
                    state.s1SubState = 'CROWD_CONTROL';

                    setTimeout(() => {
                        addChatMessage("Beta-1", "Situation under control. Individuals separated. De-escalation successful. No weapons found.");
                        setTimeout(() => {
                            addChatMessage("Beta-1", "One driver is agitated but compliant. Proceeding to collect statements and insurance details?");
                        }, 2000);
                    }, 4000);
                } else if (playerMsg.includes('wait') || playerMsg.includes('hold')) {
                    addChatMessage("Beta-1", "Holding position. But the argument is turning physical. Advising immediate intervention.");
                } else {
                    addChatMessage("Beta-1", "The crowd is filming. Drivers are shoving each other. Awaiting orders to intervene.");
                }
            }
            // 2. CROWD_CONTROL -> DETAILS
            else if (state.s1SubState === 'CROWD_CONTROL') {
                if (playerMsg.includes('proceed') || playerMsg.includes('collect') || playerMsg.includes('yes') || playerMsg.includes('detail')) {
                    addChatMessage("Beta-1", "Affirmative. Collecting IDs and statements now... ");
                    state.s1SubState = 'DETAILS';

                    setTimeout(() => {
                        addChatMessage("Beta-1", "Details secured. Minor paint damage only. Both parties have exchanged info.");
                        setTimeout(() => {
                            addChatMessage("Beta-1", "Traffic is moving again. Scene is secure. We are ready to clear.");
                        }, 3000);
                    }, 4000);
                } else {
                    addChatMessage("Beta-1", "Standing by to collect details on your mark.");
                }
            }
            // 3. DETAILS -> READY_TO_CLOSE
            else if (state.s1SubState === 'DETAILS') {
                if (playerMsg.includes('clear') || playerMsg.includes('leave') || playerMsg.includes('close') || playerMsg.includes('done')) {
                    addChatMessage("Beta-1", "Understood. We are returning to patrol. You can mark the case as closed on your end.");
                    state.s1SubState = 'READY_TO_CLOSE';
                    resolveScenario1UI(); // Show button
                } else {
                    addChatMessage("Beta-1", "We are done here. Ready to clear the scene?");
                }
            }
        }, 1500);
    }
    // Scenario 2 Logic (House)
    else if (state.stage === 'TRAP_ACTIVE') {
        setTimeout(() => {
            addChatMessage("Beta-1", "We are trying the door! It's jammed!");
        }, 2000);
    }
}

function resolveScenario1UI() {
    const card = document.getElementById('alert-s1');
    if (card) {
        card.querySelector('.call-actions').innerHTML = `
            <button class="action-btn urgent" onclick="window.closeAccidentCase()">CLOSE CASE</button>
        `;
    }
}

window.closeAccidentCase = async () => {
    state.scenario1Resolved = true;
    state.stage = 'SCENARIO_1_COMPLETE';
    showToast("ACCIDENT REPORT FILED", "success");
    document.getElementById('alert-s1').remove();

    // DB Update
    await updateVoicelessProgress({
        accidentClosed: true,
        scenario1Complete: true
    });

    // Start Timer for Scenario 2
    setTimeout(triggerScenario2, 8000); // Increased delay to account for destruct

    // Chat Self-Destruct
    addChatMessage("System", "CASE CLOSED. PURGING LOGS IN 5...");
    disableChat("Connection terminated");

    let count = 4;
    const countdown = setInterval(() => {
        addChatMessage("System", `PURGING... ${count}`);
        count--;
        if (count < 0) {
            clearInterval(countdown);
            document.getElementById('chat-messages').innerHTML = '';
            addChatMessage("System", "CHANNEL OFFLINE", false);
            document.getElementById('chat-header-status').style.display = 'none';
        }
    }, 1000);
};

// --- SCENARIO 2: VOICELESS CALLER ---

function triggerScenario2() {
    state.stage = 'CALL_INCOMING';
    state.callCount++;

    playStatic();

    // Create Call Card
    const callList = document.getElementById('calls-list');
    const callCard = document.createElement('div');
    callCard.className = 'call-card active';
    callCard.id = 'alert-s2';
    callCard.innerHTML = `
        <div class="call-header">
            <span>INCOMING CALL</span>
            <span>UNKNOWN</span>
        </div>
        <div class="call-source">NO CALLER ID</div>
        <div style="color: var(--accent-red); margin: 5px 0;">Signal: Unstable</div>
        <div class="call-actions">
            <button class="action-btn" onclick="window.answerCall()">ANSWER</button>
        </div>
    `;
    callList.appendChild(callCard);
}

window.answerCall = () => {
    const card = document.getElementById('alert-s2');
    card.querySelector('.call-actions').innerHTML = `
        <button class="action-btn urgent" onclick="window.trackLocation('kakkanad')">TRACK SIGNAL</button>
        <button class="action-btn" onclick="window.disconnectCall()">DISCONNECT</button>
    `;

    // Visual Static Effect on body
    document.body.classList.add('glitch-text'); // simplified effect
};

window.disconnectCall = () => {
    stopCall();
    document.getElementById('alert-s2').remove();
    document.body.classList.remove('glitch-text');

    if (state.stage !== 'UNIT_DISPATCHED_S2') {
        // Call comes back after 2 seconds
        setTimeout(() => {
            triggerScenario2();
            showToast("SIGNAL DETECTED AGAIN", "warning");
        }, 2000);
    }
};

function playAlert() {
    CONFIG.audio.alert.play().catch(e => console.log("Audio play failed", e));
}

function playStatic() {
    CONFIG.audio.static.volume = 0.5;
    CONFIG.audio.static.play().catch(e => console.log("Audio play failed", e));
}

function stopCall() {
    CONFIG.audio.static.pause();
    CONFIG.audio.static.currentTime = 0;
}

function startScenario2Sequence() {
    // Night Mode
    map.flyTo(CONFIG.locations.kakkanad, 16);
    document.documentElement.style.filter = "contrast(1.2) brightness(0.8)";

    addChatMessage("Beta-1", "Control, we've reached the coordinates... It's an abandoned house. Very old architecture. Looks completely dark.");

    setTimeout(() => {
        addChatMessage("Beta-1", "Shall we enter? The signal is definitely coming from inside.");
        // Mocking player approval assumption to keep flow moving or could wait prompt
        setTimeout(() => {
            addChatMessage("Control", "Proceed with caution. Secure the perimeter.", true); // Auto-prompt for flow
            enterHouse();
        }, 3000);
    }, 4000);
}

function enterHouse() {
    addChatMessage("Beta-1", "Breaching now...");

    setTimeout(() => {
        addChatMessage("Beta-1", "We're inside. It's... empty. Wait, found a landline phone off the hook.");

        setTimeout(() => {
            addChatMessage("Beta-1", "Control... the line is cut. Physically cut. But the phone is still ringing in your dashboard? That's impossible.");

            // Trap Trigger
            setTimeout(activateTrap, 4000);
        }, 5000);
    }, 4000);
}

function activateTrap() {
    state.stage = 'TRAP_ACTIVE';
    playAlert();
    showToast("CRITICAL ALERT: BIOHAZARD DETECTED", "urgent");

    addChatMessage("Beta-1", "Dmnit! The doors just slammed shut! They're locked electronically!");

    setTimeout(() => {
        addChatMessage("Beta-1", "There's a screen here... it just turned on. It says 'GAS RELEASE INITIALIZED'. Timer set for 60 minutes.");
        addChatMessage("Beta-1", "Control, we are trapped. You need to find a way to override this system from your end. The code... we need a code!");

        // End of Demo Scope
        setTimeout(() => {
            showToast("TO BE CONTINUED...", "info");
        }, 5000);
    }, 4000);
}


// --- UTILS ---

function addChatMessage(sender, text, isPlayer = false) {
    const chat = document.getElementById('chat-messages');
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${isPlayer ? 'player' : 'unit'}`;
    msgDiv.innerHTML = `
        <div class="message-sender">${sender}</div>
        ${text}
    `;
    chat.appendChild(msgDiv);
    chat.scrollTop = chat.scrollHeight;
}

function addLog(text, type) {
    // For later use in a log panel
    console.log(`[${type}] ${text}`);
}

function showToast(msg, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<i class="fas fa-${type === 'urgent' ? 'exclamation-triangle' : 'info-circle'}"></i> ${msg}`;
    container.appendChild(toast);

    // Trigger animation
    setTimeout(() => toast.classList.add('show'), 10);

    // Remove
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Progress Helper
async function updateVoicelessProgress(data) {
    if (!state.currentUser) return;
    try {
        const caseRef = doc(db, 'users', state.currentUser.uid, 'caseProgress', 'voiceles-caller');
        await setDoc(caseRef, {
            ...data,
            lastUpdated: serverTimestamp()
        }, { merge: true }); // Using setDoc with merge is safer for initial creates
    } catch (e) {
        console.error("Progress update failed", e);
    }
}

// --- STATE RESTORATION ---

async function checkProgress() {
    if (!state.currentUser) return;
    try {
        const caseRef = doc(db, 'users', state.currentUser.uid, 'caseProgress', 'voiceles-caller');
        const docSnap = await getDoc(caseRef);

        if (docSnap.exists()) {
            console.log("Restoring progress...", docSnap.data());
            restoreGameState(docSnap.data());
        }
    } catch (e) {
        console.error("Error checking progress:", e);
    }
}

async function startShift() {
    // Record Shift Start
    await updateVoicelessProgress({ shiftStarted: true });

    document.getElementById('login-overlay').style.display = 'none';
    state.stage = 'ACTIVE_SHIFT';
    addLog("System initialized. Shift started.", "system");

    // Wait for Scenario 1 Trigger
    setTimeout(triggerScenario1, 3000);
}

// ... (Rest of file) ...

function restoreGameState(data) {
    // 0. Shift Started (Update button text)
    if (data.shiftStarted) {
        const btn = document.getElementById('start-shift-btn');
        if (btn) btn.textContent = "Continue Shift";
    }

    // 1. Hide Intro if any progress beyond just starting
    if (data.sosBeaconShown || data.shiftStarted) {
        // User requested: "If user clicked start shift, next time it will be continue shift".
        // This implies the overlay might still be there but text changes?
        // OR does it mean "Resume session"? "Continue Shift" usually implies pausing.
        // If I hide the overlay immediately, that's "Continuing".
        // If I show the overlay with "Continue Shift", they have to click it again.
        // Let's assume: If meaningful progress (SOS), hide it. If just "Shift Started", update text.

        if (data.sosBeaconShown) {
            document.getElementById('login-overlay').style.display = 'none';
        }
    }

    if (data.sosBeaconShown) {
        state.stage = 'SOS_RECEIVED';

        // Rebuild SOS Card
        const callList = document.getElementById('calls-list');
        callList.innerHTML = '';
        const alertCard = document.createElement('div');
        alertCard.className = 'call-card sos active';
        alertCard.id = 'alert-s1';
        alertCard.innerHTML = `
            <div class="call-header"><span>SOS BEACON</span><span>00:14:22</span></div>
            <div class="call-source">CRASH DETECTED</div>
            <div style="color: var(--accent-amber); margin: 5px 0;">Signal Triangulated</div>
            <div class="call-actions">
                <button class="action-btn" onclick="window.trackLocation('kalamserry')">TRACK LOCATION</button>
            </div>
        `;
        callList.appendChild(alertCard);
    }

    // 2. Tracking Started
    if (data.trackingStarted) {
        const loc = CONFIG.locations.kalamserry;
        if (!markers['kalamserry'] && map) {
            markers['kalamserry'] = L.marker([loc.lat, loc.lng], { icon: pinIcon }).addTo(map).bindPopup(loc.label);
        }

        // Update Card to FIND UNIT
        const card = document.getElementById('alert-s1');
        if (card) {
            card.querySelector('.call-actions').innerHTML = `
                <button class="action-btn urgent" onclick="window.findNearestUnit()">FIND NEAREST UNIT</button>
            `;
        }
    }

    // 3. Unit Search Started
    if (data.unitSearchStarted && !data.unitArrived && !data.unitFound) {
        // If just scanning, maybe show scanning text?
        const card = document.getElementById('alert-s1');
        if (card) {
            card.querySelector('.call-actions').innerHTML = `<span style="color:var(--text-secondary); font-size: 0.8rem;">SCANNING...</span>`;
        }
    }

    // 4. Unit Found
    if (data.unitFound) {
        setChatOnline();
        const card = document.getElementById('alert-s1');
        if (card && !data.unitArrived) {
            card.querySelector('.call-actions').innerHTML = `<button class="action-btn" disabled>COMMUNICATE WITH UNIT</button>`;
        }
    }

    // 5. Unit Arrived
    if (data.unitArrived) {
        state.stage = 'UNIT_DISPATCHED';
        setChatOnline(); // Ensure chat is online
        enableChat(); // Enable inputs

        // Car at destination
        const carIcon = L.divIcon({
            className: 'custom-pin',
            html: '<div style="font-size: 20px; color: var(--accent-cyan);"><i class="fas fa-car"></i></div>',
            iconSize: [25, 25],
            iconAnchor: [12, 12]
        });
        if (map) {
            L.marker([CONFIG.locations.kalamserry.lat, CONFIG.locations.kalamserry.lng], { icon: carIcon }).addTo(map);
        }

        // Update Card
        const card = document.getElementById('alert-s1');
        if (card) {
            card.classList.remove('active');
            card.querySelector('.call-actions').innerHTML = `<span style="color:var(--accent-cyan)">UNIT ON SITE</span>`;
        }

        addChatMessage("System", "Session restored. Unit is on site.", false);
    }
}
