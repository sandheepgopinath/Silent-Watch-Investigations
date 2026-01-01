import { db, doc, getDoc, setDoc, updateDoc, serverTimestamp, logoutUser, monitorAuthState } from './auth.js';
import { GoogleGenerativeAI } from "https://esm.run/@google/generative-ai";

const genAI = null;
const model = null;

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
let markers = {};
let chatHistory = [];

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




// --- SCENARIO 1: ACCIDENT ---

// --- SCENARIO 1: ACCIDENT ---

function createSOSCard(id, title, subtitle, locKey) {
    const card = document.createElement('div');
    card.className = 'sos-alert-card active';
    card.id = id;
    card.innerHTML = `
        <div class="sos-header">
            <div class="sos-icon-box">
                <i class="fas fa-map-marker-alt pulse-icon"></i>
            </div>
            <div class="sos-info">
                <div class="sos-title">${title}</div>
                <div class="sos-subtitle">${subtitle}</div>
            </div>
            <div class="sos-timer-badge" id="${id}-timer">00:01</div>
        </div>
        
        <div class="sos-fields">
            <div class="sos-field">
                <span class="field-label">Location :</span>
                <span class="field-value" id="${id}-location">SIGNAL TRIANGULATED</span>
                <button class="field-btn" id="${id}-track-btn" onclick="window.trackLocation('${locKey}', '${id}')">Track Location</button>
            </div>
            <div class="sos-field">
                <span class="field-label">Assigned unit :</span>
                <span class="field-value" id="${id}-unit">NONE</span>
                <button class="field-btn" id="${id}-unit-btn" onclick="window.findNearestUnit('${id}')" disabled>Find nearest unit</button>
            </div>
            <div class="sos-field">
                <span class="field-label">Case Status :</span>
                <span class="field-value" id="${id}-status">NEW</span>
            </div>
            <div class="sos-field">
                <span class="field-label">Chat Status :</span>
                <span class="field-value" id="${id}-chat-status">OFFLINE</span>
                <button class="field-btn" id="${id}-chat-btn" onclick="window.chatWithUnit('${id}')" disabled>Chat with unit</button>
            </div>
        </div>
    `;

    // Start a simple timer for this card
    let seconds = 1;
    const timerInterval = setInterval(() => {
        if (!document.getElementById(id)) {
            clearInterval(timerInterval);
            return;
        }
        seconds++;
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        document.getElementById(`${id}-timer`).textContent =
            `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }, 1000);

    return card;
}

function triggerScenario1() {
    state.stage = 'SOS_RECEIVED';
    playAlert();

    // Verify progress
    updateVoicelessProgress({ sosBeaconShown: true });

    // Create Alert Card
    const callList = document.getElementById('calls-list');
    callList.innerHTML = '';

    const alertCard = createSOSCard('alert-s1', 'OFFICER DOWN', 'SECTOR 4 • PANIC #9921', 'kalamserry');
    callList.appendChild(alertCard);
}

// Global scope for HTML button access
window.trackLocation = (locKey, alertId) => {
    const loc = CONFIG.locations[locKey];
    if (!loc) return;

    // Auto-scroll for mobile
    if (window.innerWidth <= 768) {
        document.getElementById('map-container').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    const locField = document.getElementById(`${alertId}-location`);
    const trackBtn = document.getElementById(`${alertId}-track-btn`);
    const unitBtn = document.getElementById(`${alertId}-unit-btn`);
    const statusField = document.getElementById(`${alertId}-status`);

    // Show Tracking state
    if (trackBtn) {
        trackBtn.textContent = "TRACKING...";
        trackBtn.disabled = true;
    }

    setTimeout(() => {
        if (locField) locField.textContent = loc.label;
        if (trackBtn) trackBtn.remove();
        if (unitBtn) unitBtn.disabled = false;
        if (statusField && statusField.textContent === 'NEW') statusField.textContent = 'OPEN';

        if (locKey === 'kalamserry' && state.stage === 'SOS_RECEIVED') {
            updateVoicelessProgress({ trackingStarted: true });
        }

        if (locKey === 'kakkanad' && (state.stage === 'CALL_INCOMING' || state.stage === 'CALL_ACTIVE')) {
            const dispatchBtn = document.getElementById(`${alertId}-dispatch-btn`);
            if (dispatchBtn) {
                dispatchBtn.disabled = false;
                dispatchBtn.onclick = () => window.dispatchUnit('kakkanad', alertId);
            }
        }
    }, 1000);
};

window.chatWithUnit = (alertId) => {
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
        chatInput.focus();
        showToast("COMMUNICATION CHANNEL ACTIVE", "success");
    }
    // Auto-scroll to chat on mobile
    if (window.innerWidth <= 768) {
        document.querySelector('.panel:last-child').scrollIntoView({ behavior: 'smooth' });
    }
};

let carMarker = null;

window.findNearestUnit = (alertId) => {
    updateVoicelessProgress({ unitSearchStarted: true });
    showToast("Scanning for nearby units...", "info");

    const unitField = document.getElementById(`${alertId}-unit`);
    const unitBtn = document.getElementById(`${alertId}-unit-btn`);

    if (unitField) unitField.textContent = "FINDING UNIT...";
    if (unitBtn) unitBtn.remove();

    setTimeout(() => {
        // Unit Found - Animate
        updateVoicelessProgress({ unitFound: true });
        setChatOnline(); // Enable UI
        enableChat(); // Enable Input immediately
        showToast("UNIT BETA-1 IDENTIFIED", "success");

        if (unitField) unitField.textContent = "BETA-1";

        // Enable Chat on card immediately when unit is found
        const chatStatus = document.getElementById(`${alertId}-chat-status`);
        const chatBtn = document.getElementById(`${alertId}-chat-btn`);
        if (chatStatus) chatStatus.textContent = "ACTIVE";
        if (chatBtn) chatBtn.disabled = false;

        // Auto-start unit movement for Scenario 1
        startUnitMovement(alertId);

        function startUnitMovement(id) {
            // Start point (arbitrary offset)
            const startLat = 10.0570;
            const startLng = 76.3280;
            const endLat = CONFIG.locations.kalamserry.lat;
            const endLng = CONFIG.locations.kalamserry.lng;

            // Initial Message
            addChatMessage("Beta-1", "Dispatch, we have your location. ETA 5 seconds. We are en route.");

            // Fake Animation (5s)
            const duration = 5000;
            const startTime = Date.now();

            function animate() {
                const now = Date.now();
                const progress = Math.min((now - startTime) / duration, 1);

                if (progress < 1) {
                    requestAnimationFrame(animate);
                } else {
                    // Arrival
                    state.stage = 'UNIT_DISPATCHED';
                    updateVoicelessProgress({ unitArrived: true });
                    const card = document.getElementById(id);
                    if (card) card.classList.remove('active');

                    // Update Chat Status UI
                    const chatStatus = document.getElementById(`${id}-chat-status`);
                    const chatBtn = document.getElementById(`${id}-chat-btn`);
                    if (chatStatus) chatStatus.textContent = "ACTIVE";
                    if (chatBtn) chatBtn.disabled = false;

                    // Enable Chat (Ensure it stays enabled)
                    enableChat();
                    addChatMessage("Beta-1", "Dispatch, we have arrived at the coordinates. It's a collision.");
                    setTimeout(() => {
                        addChatMessage("Beta-1", "I see a crowd gathering around the vehicles. It looks tense. Should I intervene directly or hold back?");
                    }, 2000);
                }
            }
            requestAnimationFrame(animate);
        }

        // Auto-start for this scenario's demo flow or wait for button?
        // Let's wait for "DISPATCH UNIT" click
    }, 2000); // 2s scanning delay
};

// Reused for S2
window.dispatchUnit = (locKey, alertId) => {
    if (locKey === 'kakkanad') {
        state.stage = 'UNIT_DISPATCHED_S2';
        showToast("UNIT BETA-1 REDIRECTED", "warning");

        stopCall();

        const dispatchBtn = document.getElementById(`${alertId}-dispatch-btn`);
        const statusField = document.getElementById(`${alertId}-status`);

        if (dispatchBtn) {
            dispatchBtn.remove();
        }
        if (statusField) statusField.textContent = "OPEN";

        addChatMessage("Beta-1", "Copy that Control. Diverting to Kakkanad coordinates. It's... pretty isolated out there.");
        startScenario2Sequence(); // Trigger faster for demo since movement is fake now
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

async function handleAIResponse(playerMsg) {
    const chatContainer = document.getElementById('chat-messages');

    // Scenario Context
    let context = "";
    if (state.stage === 'UNIT_DISPATCHED' && !state.scenario1Resolved) {
        context = `You are Unit Beta-1, a ground responder for "Silent Watch Investigations". 
        CURRENT SITUATION: You have just arrived at Kalamassery Junction where an accident occurred. A crowd is gathering and two drivers are arguing. 
        YOUR GOAL: De-escalate the situation, collect details, and clear the scene.
        SUB-STATE: Currently at ${state.s1SubState}. 
        STYLE: Use short, to-the-point responses. Avoid poetic or flowery language. Act like a professional responder in a high-stress situation.
        INSTRUCTIONS: 
        1. If state is ARRIVED: Describe the tense scene concisely. Wait for orders to intervene.
        2. If state is CROWD_CONTROL: You've separated them. One driver is agitated. Wait for orders to collect details.
        3. If state is DETAILS: You have the info. Scene is secure. Ready to clear. Notify player to archive/close the case once you feel the scene is cleared.
        - Act human, professional, but slightly stressed by the crowd. 
        - If asked off-topic stuff (weather, personal life, etc.), answer briefly or dismissively but redirect focus to the emergency. Eg: "Look, I don't think the weather is our priority right now. We have people fighting here."
        - DO NOT repeat yourself. Use variety in your sentences.
        - Once humanly possible, prompt the user to let you clear the scene so they can close the case.`;
    } else if (state.stage === 'TRAP_ACTIVE') {
        context = `You are Unit Beta-1. YOU ARE TRAPPED in an abandoned house in Kakkanad. 
        SITUATION: Electronic doors slammed shut. A screen says 'GAS RELEASE INITIALIZED'. There is a countdown. 
        STYLE: Short, urgent, tactical responses. No poetic fluff. 
        TONE: Urgent, panicking, audible heavy breathing in text.
        GOAL: Describe your surroundings (old monitors, reinforced glass, hissing sound) and ask for override codes or instructions. The situation is dire.`;
    } else {
        context = `You are Unit Beta-1. You are in transit or on standby. Be concise.`;
    }

    // Add Typing Indicator
    const typingMsg = document.createElement('div');
    typingMsg.className = 'message unit typing';
    typingMsg.innerHTML = `<div class="message-sender">Beta-1</div><span class="dot">.</span><span class="dot">.</span><span class="dot">.</span>`;
    chatContainer.appendChild(typingMsg);
    chatContainer.scrollTop = chatContainer.scrollHeight;

    try {
        // Fetch API Key dynamically (Align with working dashboard.js)
        let apiKey = null;
        try {
            const configRef = doc(db, "config", "api_keys");
            const configSnap = await getDoc(configRef);
            if (configSnap.exists()) apiKey = configSnap.data().gemini;
        } catch (e) {
            console.error("Database error fetching key:", e);
        }

        if (!apiKey) {
            typingMsg.remove();
            addChatMessage("Beta-1", "Dispatch, voice module offline. Check system config.");
            return;
        }

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite" });

        // Keep history manageable
        if (chatHistory.length > 10) chatHistory.shift();

        const fullPrompt = `${context}\n\nRecent History:\n${chatHistory.join('\n')}\n\nControl (User): ${playerMsg}\n\nBeta-1:`;

        console.log("Calling Gemini (2.0-flash-lite) with prompt:", fullPrompt);

        const result = await model.generateContent(fullPrompt);
        const response = await result.response;
        const responseText = response.text();

        console.log("Gemini Response:", responseText);

        // Remove Typing Indicator
        typingMsg.remove();

        // Add to history
        chatHistory.push(`Control: ${playerMsg}`);
        chatHistory.push(`Beta-1: ${responseText}`);

        addChatMessage("Beta-1", responseText);

        // Sub-state advancement based on AI content (rough heuristic)
        const lowerRes = responseText.toLowerCase();
        if (state.stage === 'UNIT_DISPATCHED') {
            if (state.s1SubState === 'ARRIVED' && (lowerRes.includes('interven') || lowerRes.includes('separat') || lowerRes.includes('step out'))) {
                state.s1SubState = 'CROWD_CONTROL';
            } else if (state.s1SubState === 'CROWD_CONTROL' && (lowerRes.includes('collect') || lowerRes.includes('details') || lowerRes.includes('ids'))) {
                state.s1SubState = 'DETAILS';
            } else if (state.s1SubState === 'DETAILS' && (lowerRes.includes('clear') || lowerRes.includes('closed') || lowerRes.includes('archive'))) {
                resolveScenario1UI();
            }
        }

    } catch (e) {
        console.error("AI Error:", e);
        typingMsg.remove();
        addChatMessage("Beta-1", "Dispatch, signal is breaking up. Repeat your last message.");
    }
}

function resolveScenario1UI() {
    const statusField = document.getElementById('alert-s1-status');
    if (statusField) statusField.textContent = "CLOSED";
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

    // Create Call Card using same UI
    const callList = document.getElementById('calls-list');
    const callCard = createSOSCard('alert-s2', 'INCOMING SIGNAL', 'UNKNOWN ORIGIN • SIGNAL UNSTABLE', 'kakkanad');
    callList.appendChild(callCard);

    // Initial state for Call
    document.getElementById('alert-s2-location').textContent = "TRIANGULATING...";
    document.getElementById('alert-s2-track-btn').innerHTML = "ANSWER";
    document.getElementById('alert-s2-track-btn').onclick = () => window.answerCall();
}

window.answerCall = () => {
    const trackBtn = document.getElementById('alert-s2-track-btn');
    const statusField = document.getElementById('alert-s2-status');

    if (statusField) statusField.textContent = "OPEN";
    if (trackBtn) {
        trackBtn.innerHTML = "TRACK SIGNAL";
        trackBtn.onclick = () => window.trackLocation('kakkanad', 'alert-s2');
    }

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
    if (data.sosBeaconShown) {
        document.getElementById('login-overlay').style.display = 'none';
        state.stage = 'SOS_RECEIVED';

        // Rebuild SOS Card
        const callList = document.getElementById('calls-list');
        callList.innerHTML = '';
        const alertCard = createSOSCard('alert-s1', 'OFFICER DOWN', 'SECTOR 4 • PANIC #9921', 'kalamserry');
        callList.appendChild(alertCard);
    }

    // 2. Tracking Started
    if (data.trackingStarted) {
        const loc = CONFIG.locations.kalamserry;

        // Update Field UI
        const locField = document.getElementById('alert-s1-location');
        const trackBtn = document.getElementById('alert-s1-track-btn');
        const unitBtn = document.getElementById('alert-s1-unit-btn');
        const statusField = document.getElementById('alert-s1-status');

        if (locField) locField.textContent = loc.label;
        if (trackBtn) trackBtn.remove();
        if (unitBtn) unitBtn.disabled = false;
        if (statusField) statusField.textContent = 'OPEN';
    }

    // 3. Unit Search Started
    if (data.unitSearchStarted) {
        const unitField = document.getElementById('alert-s1-unit');
        const unitBtn = document.getElementById('alert-s1-unit-btn');
        if (unitField) unitField.textContent = "FINDING UNIT...";
        if (unitBtn) unitBtn.remove();
    }

    // 4. Unit Found
    if (data.unitFound) {
        setChatOnline();
        const unitField = document.getElementById('alert-s1-unit');
        const dispatchBtn = document.getElementById('alert-s1-dispatch-btn');
        if (unitField) unitField.textContent = "BETA-1";
    }

    // 5. Unit Arrived
    if (data.unitArrived) {
        state.stage = 'UNIT_DISPATCHED';
        setChatOnline(); // Ensure chat is online
        enableChat(); // Enable inputs

        // Update Card
        const card = document.getElementById('alert-s1');
        const dispatchBtn = document.getElementById('alert-s1-dispatch-btn');
        const statusField = document.getElementById('alert-s1-status');

        if (card) card.classList.remove('active');
        if (dispatchBtn) dispatchBtn.remove();
        if (statusField) statusField.textContent = 'OPEN';

        // Update Chat Status if arrived
        if (data.unitArrived) {
            const chatStatus = document.getElementById('alert-s1-chat-status');
            const chatBtn = document.getElementById('alert-s1-chat-btn');
            if (chatStatus) chatStatus.textContent = "ACTIVE";
            if (chatBtn) chatBtn.disabled = false;
        }

        addChatMessage("System", "Session restored. Unit is on site.", false);
    }

    if (data.accidentClosed) {
        state.scenario1Resolved = true;
        const cardS1 = document.getElementById('alert-s1');
        if (cardS1) cardS1.remove();
    }
}
