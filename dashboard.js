import { monitorAuthState, logoutUser, db, doc, getDoc, setDoc, updateDoc, serverTimestamp, arrayUnion } from './auth.js';
import { fetchAgents } from './agents_core.js';
import { GoogleGenerativeAI } from "https://esm.run/@google/generative-ai";

document.addEventListener('DOMContentLoaded', () => {
    let currentUser = null;

    // Auth Protection
    // Prevent redirect loop if already on login page
    const minimalPath = window.location.pathname.endsWith('/') || window.location.pathname.endsWith('index.html');

    if (!minimalPath) {
        monitorAuthState(
            async (user) => {
                // User is logged in
                console.log("Authorized access:", user.email);
                currentUser = user;
                updateUserProfile(user);
                await checkBlackwoodProgress(user.uid);
                await checkLockerStatus(user.uid);
                if (typeof aiManager !== 'undefined') {
                    await aiManager.checkCooldowns(user.uid);
                }
            },
            () => {
                // No user and NOT on index.html -> Redirect
                console.warn("Unauthorized access attempt. Redirecting...");
                window.location.replace('index.html'); // replace prevents back button history
            }
        );
    } else {
        monitorAuthState(
            (user) => {
                // Optional: Auto-login
            },
            () => {
                // Stay on login page
            }
        );
    }

    async function checkBlackwoodProgress(uid) {
        try {
            const caseRef = doc(db, 'users', uid, 'caseProgress', 'blackwood-manor-mystery');
            const caseSnap = await getDoc(caseRef);

            const blackwoodCard = document.querySelector('.case-card:first-child');
            const btn = blackwoodCard ? blackwoodCard.querySelector('.investigate-btn') : null;

            if (caseSnap.exists()) {
                const data = caseSnap.data();
                if (data.caseClosed === true) {
                    markBlackwoodClosed();
                    if (btn) btn.dataset.status = 'closed';
                } else if (data.caseAccepted === true) {
                    if (btn) {
                        btn.dataset.status = 'in-progress';
                        btn.textContent = "OPEN CASE";
                    }

                    if (data.briefingViewed) markEvidenceViewed('card-brief');
                    if (data.postmortemViewed) markEvidenceViewed('card-report');
                    if (data.layoutViewed) markEvidenceViewed('card-layout');
                    if (data.cctvViewed) {
                        markEvidenceViewed('card-cctv');
                        const btnFoundKiller = document.getElementById('btn-found-killer');
                        if (btnFoundKiller) btnFoundKiller.style.display = 'flex';
                    }
                } else {
                    if (btn) btn.dataset.status = 'new';
                }

                if (data.anyaProfileUnlocked) {
                    const anyaCard = document.getElementById('suspect-anya');
                    if (anyaCard) anyaCard.style.display = 'block';
                }
                if (data.cctvUnlocked) {
                    const cctvCard = document.getElementById('card-cctv');
                    if (cctvCard) cctvCard.style.display = 'block';
                }

                if (data.anyaProfileUnlocked && window.setWeather && window.location.pathname.includes('case-blackwood')) {
                    window.setWeather('leaves');
                }

            } else {
                if (btn) btn.dataset.status = 'new';
            }
        } catch (error) {
            console.error("Error checking case progress:", error);
        }
    }

    function markBlackwoodClosed() {
        const blackwoodCard = document.querySelector('.case-card:first-child');
        if (!blackwoodCard) return;

        const badge = blackwoodCard.querySelector('.case-badge');
        if (badge) {
            badge.textContent = "CASE CLOSED";
            badge.className = "case-badge";
            badge.style.borderColor = "var(--accent-gold)";
            badge.style.color = "var(--accent-gold)";
            badge.style.boxShadow = "0 0 10px rgba(217, 165, 32, 0.5)";
        }

        const btn = blackwoodCard.querySelector('.investigate-btn');
        if (btn) {
            btn.textContent = "REVIEW FILE";
            btn.classList.add('solved-btn');
            btn.dataset.status = "closed";
        }
    }

    async function updateUserProfile(user) {
        const nameEl = document.querySelector('.user-info .name');
        const emailEl = document.querySelector('.user-info .status');
        const avatarEl = document.querySelector('.avatar');

        if (user.displayName) {
            nameEl.textContent = user.displayName;
        } else {
            try {
                const profileRef = doc(db, 'users', user.uid, 'investigatorProfile', user.uid);
                const profileSnap = await getDoc(profileRef);
                if (profileSnap.exists()) {
                    const data = profileSnap.data();
                    if (data.name) nameEl.textContent = data.name;
                }
            } catch (e) {
                console.error("Error fetching profile name:", e);
                nameEl.textContent = "Detective";
            }
        }

        if (user.email) emailEl.textContent = user.email;
        if (user.photoURL) {
            avatarEl.style.backgroundImage = `url('${user.photoURL}')`;
            avatarEl.style.backgroundSize = 'cover';
        }
    }

    const profileToggle = document.getElementById('profile-toggle');
    const profileWrapper = document.querySelector('.user-profile-wrapper');
    const logoutBtn = document.getElementById('logout-btn');

    // Header Scroll Logic
    let lastScrollY = window.scrollY;
    const header = document.querySelector('.page-header');
    const menuButton = document.getElementById('menu-toggle');

    if (header) {
        window.addEventListener('scroll', () => {
            const currentScrollY = window.scrollY;

            // If scrolling down AND passed 100px threshold
            if (currentScrollY > lastScrollY && currentScrollY > 100) {
                header.classList.add('hidden');
                if (menuButton) menuButton.classList.add('hidden');
            } else {
                // If scrolling up OR at the top
                header.classList.remove('hidden');
                if (menuButton) menuButton.classList.remove('hidden');
            }

            lastScrollY = currentScrollY;
        }, { passive: true });
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

    const menuToggle = document.getElementById('menu-toggle');
    const closeMenu = document.getElementById('close-menu');
    const path = window.location.pathname;
    const isBlackwood = path.includes('case-blackwood');

    if (window.setWeather) {
        if (isBlackwood) {
            window.setWeather('clear');
        } else {
            window.setWeather('rain');
        }
    }
    const sidebar = document.getElementById('sidebar');

    if (menuToggle && sidebar) {
        menuToggle.addEventListener('click', () => {
            sidebar.classList.add('active');
            menuToggle.style.display = 'none';
        });
    }

    if (closeMenu && sidebar) {
        closeMenu.addEventListener('click', () => {
            sidebar.classList.remove('active');
            if (menuToggle) menuToggle.style.display = 'block';
        });
    }

    document.addEventListener('click', (e) => {
        if (sidebar && sidebar.classList.contains('active')) {
            if (!sidebar.contains(e.target) && !menuToggle.contains(e.target)) {
                sidebar.classList.remove('active');
                if (menuToggle) menuToggle.style.display = 'block';
            }
        }
    });

    function showToast(message) {
        const existing = document.querySelector('.toast-notification');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = 'toast-notification';
        toast.innerHTML = `<i class="fas fa-exclamation-circle"></i> <span>${message}</span>`;
        document.body.appendChild(toast);
        void toast.offsetWidth;
        toast.classList.add('show');

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 500);
        }, 4000);
    }

    async function triggerRohanIntrusion(uid) {
        // Chat messages are now handled by the scripted sequence in sendMessage
        // This function handles the state updates and UI unlocks


        try {
            const caseRef = doc(db, 'users', uid, 'caseProgress', 'blackwood-manor-mystery');
            const cctvPassword = Math.floor(10000 + Math.random() * 90000).toString();
            await setDoc(caseRef, {
                anyaProfileUnlocked: true,
                cctvUnlocked: true,
                cctvPassword: cctvPassword,
                rohanIntrusionTriggered: true,
                lastUpdated: serverTimestamp()
            }, { merge: true });

            const anyaCard = document.getElementById('suspect-anya');
            if (anyaCard) {
                anyaCard.style.display = 'block';
                anyaCard.classList.add('fade-in');
            }
            const cctvCard = document.getElementById('card-cctv');
            if (cctvCard) {
                cctvCard.style.display = 'block';
                cctvCard.classList.add('fade-in');
            }

            setTimeout(() => {
                showToast("⚠️ NEW SUSPECT: ANYA UNLOCKED");
                if (window.setWeather) window.setWeather('leaves');

                setTimeout(() => {
                    showToast("📹 EVIDENCE UNLOCKED: CCTV FOOTAGE");
                }, 4500);
            }, 4000);

        } catch (e) {
            console.error("Error triggering intrusion:", e);
        }
    }

    if (path.includes('agents')) {
        fetchAgents();
    } else if (path.includes('escape-room')) {
        startEscapeAnimation();
    } else if (path.includes('case-blackwood')) {
        const btn = document.getElementById('btn-interrogate-rohan');
        if (btn) btn.disabled = false;
    }

    const modalOverlay = document.getElementById('case-modal-overlay');
    const modalContentContainer = document.querySelector('.case-modal .modal-content');
    const modalActionsContainer = document.querySelector('.case-modal .modal-actions');
    const modalTitle = document.querySelector('.case-modal .modal-header h2');

    let originalBriefHTML = "";
    if (modalContentContainer) {
        originalBriefHTML = modalContentContainer.innerHTML;
    }

    function restoreBriefModal() {
        if (modalContentContainer && originalBriefHTML) {
            modalContentContainer.innerHTML = originalBriefHTML;
            if (modalActionsContainer) modalActionsContainer.style.display = 'flex';
            if (modalTitle) modalTitle.textContent = "Investigation Brief";
        }
    }

    const closeModalBtn = document.querySelector('.close-modal');
    const rejectCaseBtn = document.getElementById('reject-case');
    const acceptCaseBtn = document.getElementById('accept-case');

    const blackwoodBtn = document.querySelector('.case-card:first-child .investigate-btn');
    const voicelessBtn = document.getElementById('btn-voiceless');

    if (blackwoodBtn) {
        blackwoodBtn.addEventListener('click', () => {
            const status = blackwoodBtn.dataset.status;

            if (status === 'closed') {
                if (currentUser) {
                    showPersistentVictoryScreen(currentUser.uid);
                }
            } else if (status === 'in-progress') {
                window.location.href = 'case-blackwood.html';
            } else {
                restoreBriefModal();
                if (acceptCaseBtn) acceptCaseBtn.dataset.target = 'blackwood';
                openModal();
            }
        });
    }

    // Generic Password Modal Logic (Reused for Case Access)
    function showPasswordPrompt(callback) {
        // Check if exists, else create
        let pwdModal = document.getElementById('access-pwd-modal');
        if (!pwdModal) {
            pwdModal = document.createElement('div');
            pwdModal.id = 'access-pwd-modal';
            pwdModal.className = 'modal-overlay';
            pwdModal.innerHTML = `
                <div class="auth-card" style="width: 380px; padding: 2.5rem; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); backdrop-filter: blur(15px); box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37); border-radius: 16px; text-align: center;">
                    <div style="margin-bottom: 1.5rem; font-size: 3rem; color: var(--accent-cyan); text-shadow: 0 0 15px rgba(0, 240, 255, 0.3);">
                        <i class="fas fa-fingerprint"></i>
                    </div>
                    <h2 style="color: #fff; font-family: 'Cinzel', serif; margin-bottom: 0.5rem; font-weight: 400; letter-spacing: 1px;">Security Breach Detected</h2>
                    <p style="color: #aaa; margin-bottom: 2rem; font-size: 0.85rem; line-height: 1.5;">Level 5 Clearance Required.<br>Enter authorized credentials to proceed.</p>
                    
                    <div class="input-group" style="margin-bottom: 1.5rem; position: relative;">
                        <input type="password" id="access-pwd-input" placeholder="ACCESS CODE" 
                            style="width: 100%; padding: 12px; background: rgba(0, 0, 0, 0.3); border: 1px solid rgba(255, 255, 255, 0.1); color: var(--accent-cyan); text-align: center; font-family: 'Share Tech Mono', monospace; font-size: 1.1rem; letter-spacing: 3px; border-radius: 8px; outline: none; transition: all 0.3s;">
                    </div>
                    
                    <div style="display: flex; gap: 10px;">
                        <button id="access-pwd-cancel" style="flex: 1; padding: 10px; background: transparent; border: 1px solid rgba(255, 255, 255, 0.2); color: #888; border-radius: 8px; cursor: pointer; transition: all 0.3s;">CANCEL</button>
                        <button id="access-pwd-submit" style="flex: 1; padding: 10px; background: rgba(0, 240, 255, 0.1); border: 1px solid var(--accent-cyan); color: var(--accent-cyan); border-radius: 8px; cursor: pointer; font-weight: bold; transition: all 0.3s; box-shadow: 0 0 10px rgba(0, 240, 255, 0.1);">AUTHENTICATE</button>
                    </div>
                    
                    <p id="access-pwd-error" style="color: #ff4d4d; font-size: 0.8rem; margin-top: 15px; min-height: 1.2em; font-family: monospace;"></p>
                </div>
            `;
            document.body.appendChild(pwdModal);

            // Event Listeners for the new modal
            const submitBtn = pwdModal.querySelector('#access-pwd-submit');
            const cancelBtn = pwdModal.querySelector('#access-pwd-cancel');
            const input = pwdModal.querySelector('#access-pwd-input');
            const error = pwdModal.querySelector('#access-pwd-error');

            const submitHandler = () => {
                if (input.value === 'swadmins123') {
                    submitBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> AUTHENTICATING...';
                    submitBtn.disabled = true;
                    input.disabled = true;

                    // Pass a function to close/reset the modal to the callback
                    // So the callback decides when/if to close it (e.g. not if redirecting)
                    const closeAndReset = () => {
                        pwdModal.style.display = 'none';
                        input.value = '';
                        error.textContent = '';
                        submitBtn.innerHTML = 'AUTHENTICATE';
                        submitBtn.disabled = false;
                        input.disabled = false;
                    };


                    // Use the stored callback
                    if (pwdModal._authCallback) {
                        pwdModal._authCallback(closeAndReset);
                    }

                } else {
                    error.textContent = 'ACCESS DENIED: Invalid Passcode';
                    input.classList.add('shake');
                    setTimeout(() => input.classList.remove('shake'), 500);
                }
            };

            submitBtn.addEventListener('click', submitHandler);
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') submitHandler();
            });
            cancelBtn.addEventListener('click', () => {
                pwdModal.style.display = 'none';
                input.value = '';
                error.textContent = '';
            });
        }

        // Update the callback reference every time the modal is shown
        pwdModal._authCallback = callback;

        pwdModal.style.display = 'flex';
        setTimeout(() => pwdModal.querySelector('input').focus(), 100);
    }

    if (voicelessBtn) {
        voicelessBtn.addEventListener('click', async () => {
            showPasswordPrompt(async (closeAuthModal) => {
                // Check if case already started
                let isAlreadyActive = false;
                if (currentUser) {
                    try {
                        const caseRef = doc(db, 'users', currentUser.uid, 'caseProgress', 'voiceles-caller');
                        const caseSnap = await getDoc(caseRef);
                        if (caseSnap.exists()) {
                            isAlreadyActive = true;
                        }
                    } catch (e) {
                        console.error("Error checking voiceless progress", e);
                    }
                }

                if (isAlreadyActive) {
                    window.location.href = 'case-voiceless.html';
                    // Do NOT close the modal, let the redirect happen while loading
                } else {
                    // Start New: Insert Voiceless Caller Brief
                    // For this path, we DO close the auth modal to show the brief modal
                    // Start New: Insert Voiceless Caller Brief
                    // For this path, we DO close the auth modal to show the brief modal
                    // BUT we do it AFTER opening the new modal to prevent flashing
                    // closeAuthModal(); // Moved down 


                    if (modalContentContainer) {
                        modalContentContainer.innerHTML = `
                            <div class="case-meta">
                                <span class="case-id" style="color: var(--accent-cyan); border-color: var(--accent-cyan)">Case File: #002</span>
                                <span class="case-title">The Voiceless Caller</span>
                            </div>

                            <div class="brief-section">
                                <h3><i class="fas fa-signal"></i> Alert Type</h3>
                                <p><strong>Priority 1 Distress Signal</strong> via Emergency Broadcast Frequencies.</p>
                            </div>

                            <div class="brief-section">
                                <h3><i class="fas fa-map-marker-alt"></i> Location</h3>
                                <p>Triangulated to <strong>Greater Cochin Area</strong>. Specific coordinates unstable.</p>
                            </div>

                            <div class="brief-section">
                                <h3><i class="fas fa-file-audio"></i> Background</h3>
                                <p>Control room has been receiving intermittent silent calls and erratic SOS beacons for the past 48 hours. Intelligence suggests a pattern targeting emergency responder frequencies.</p>
                            </div>

                            <div class="brief-section">
                                <h3><i class="fas fa-crosshairs"></i> Mission</h3>
                                <p>1. Assume command of <strong>Unit Beta-1</strong> (Ground Response).<br>
                                2. Track and locate the signal source.<br>
                                3. Investigate potential threats.</p>
                            </div>

                            <div class="alert-box" style="border-left-color: var(--accent-amber)">
                                <h4 style="color: var(--accent-amber)"><i class="fas fa-exclamation-circle"></i> Protocol</h4>
                                <p>Expect hostility. Maintain constant communication with the ground team.</p>
                            </div>
                        `;
                        if (modalTitle) modalTitle.textContent = "Mission Briefing";
                        if (modalActionsContainer) modalActionsContainer.style.display = 'flex';
                        if (acceptCaseBtn) acceptCaseBtn.dataset.target = 'voiceless';

                        // Open the briefing modal FIRST
                        openModal();

                        // THEN close the auth modal (loading state) after a short delay or immediately
                        // Closing immediately might show a z-index glitch, but better than dashboard flash
                        closeAuthModal();
                    }
                }
            });
        });
    }

    function openModal() {
        modalOverlay.style.display = 'flex';
        requestAnimationFrame(() => {
            modalOverlay.classList.add('active');
        });
    }

    function closeModal() {
        modalOverlay.classList.remove('active');
        setTimeout(() => {
            modalOverlay.style.display = 'none';
        }, 300);
    }

    if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);
    if (rejectCaseBtn) rejectCaseBtn.addEventListener('click', closeModal);

    if (modalOverlay) {
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) closeModal();
        });
    }

    async function initializeCaseProgress(uid) {
        try {
            const caseRef = doc(db, 'users', uid, 'caseProgress', 'blackwood-manor-mystery');
            const caseSnap = await getDoc(caseRef);

            if (!caseSnap.exists()) {
                await setDoc(caseRef, {
                    caseId: "blackwood-manor-mystery",
                    userId: uid,
                    caseAccepted: true,
                    briefingViewed: true,
                    caseClosed: false,
                    caseStartTime: serverTimestamp(),
                    lastUpdated: serverTimestamp(),
                    timeInSeconds: 0,
                    postmortemViewed: false,
                    layoutViewed: false,
                    cctvUnlocked: false,
                    anyaProfileUnlocked: false,
                    diaryUnlocked: false,
                    killerIdentified: false,
                    motiveIdentified: false,
                    modusOperandiIdentified: false,
                    lockerAttempts: 0,
                    lockerLockoutUntil: null
                });
            }
        } catch (error) {
            console.error("Error creating case entry:", error);
            alert("Secure Connection Failed. Please try again.");
        }
    }

    async function initializeVoicelessProgress(uid) {
        try {
            const caseRef = doc(db, 'users', uid, 'caseProgress', 'voiceles-caller');
            const caseSnap = await getDoc(caseRef);

            if (!caseSnap.exists()) {
                await setDoc(caseRef, {
                    caseId: "voiceles-caller",
                    userId: uid,
                    caseAccepted: true,
                    caseStartTime: serverTimestamp(),
                    lastUpdated: serverTimestamp(),
                    stage: 'IDLE' // Initial stage
                });
            }
        } catch (error) {
            console.error("Error creating voiceless case entry:", error);
            alert("Secure Connection Failed. Please try again.");
        }
    }

    function startEscapeAnimation() {
        // Only run if elements exist
        const escapeView = document.getElementById('escape-room-view');
        if (!escapeView) {
            return;
        }

        const line1 = document.getElementById('line1');
        const line2 = document.getElementById('line2');

        if (!line1 || !line2) return;

        line1.textContent = '';
        line2.textContent = '';

        line1.style.borderRight = 'none';
        line2.style.borderRight = 'none';

        // UPDATED TEXT HERE
        const text1 = "Kochi's First Immersive Escape Room!";
        const text2 = "Launching Soon!";

        let i = 0;
        let j = 0;

        function typeLine1() {
            if (i < text1.length) {
                line1.textContent += text1.charAt(i);
                line1.style.borderRight = '2px solid #e9d5ff';
                i++;
                setTimeout(typeLine1, 80);
            } else {
                line1.style.borderRight = 'none';
                setTimeout(typeLine2, 500);
            }
        }

        function typeLine2() {
            if (j < text2.length) {
                line2.textContent += text2.charAt(j);
                line2.style.borderRight = '2px solid #e9d5ff';
                j++;
                setTimeout(typeLine2, 80);
            } else {
                line2.style.borderRight = 'none';
                showSolveButton();
            }
        }

        function showSolveButton() {
            const btn = document.getElementById('static-solve-btn');
            if (btn) {
                btn.style.display = 'inline-block';
                btn.classList.add('fade-in');
            }
        }

        typeLine1();
    }


    if (acceptCaseBtn) {
        acceptCaseBtn.addEventListener('click', async () => {
            const target = acceptCaseBtn.dataset.target;
            if (currentUser) {
                closeModal();
                if (target === 'blackwood') {
                    // acceptCaseBtn.innerText = "Initializing..."; // Removed as per instruction
                    await initializeCaseProgress(currentUser.uid);
                    // if (blackwoodBtn) { // Removed as per instruction
                    //     blackwoodBtn.textContent = "OPEN CASE";
                    //     blackwoodBtn.dataset.status = 'in-progress';
                    // }
                    window.location.href = 'case-blackwood.html';
                } else if (target === 'voiceless') {
                    await initializeVoicelessProgress(currentUser.uid);
                    window.location.href = 'case-voiceless.html';
                }
            }
        });
    }

    const cardBrief = document.getElementById('card-brief');
    const cardLocker = document.getElementById('card-locker');
    const cardReport = document.getElementById('card-report');
    const cardLayout = document.getElementById('card-layout');

    if (cardReport) {
        cardReport.addEventListener('click', () => {
            showEvidence("Postmortem Report", "https://firebasestorage.googleapis.com/v0/b/studio-3143701674-93ada.firebasestorage.app/o/PostMortem%20Report.png?alt=media&token=26b19521-a238-4391-a314-9c255d8151b4");
            if (currentUser) updateEvidenceStatus(currentUser.uid, 'postmortemViewed', 'card-report');
        });
    }

    if (cardLayout) {
        cardLayout.addEventListener('click', () => {
            showEvidence("Manor Layout", "https://firebasestorage.googleapis.com/v0/b/studio-3143701674-93ada.firebasestorage.app/o/layout.jpg?alt=media&token=35a6bbfc-6279-472f-a15f-a6522c4decb6");
            if (currentUser) updateEvidenceStatus(currentUser.uid, 'layoutViewed', 'card-layout');
        });
    }

    if (cardBrief) {
        cardBrief.addEventListener('click', () => {
            restoreBriefModal();
            const actions = document.querySelector('.modal-actions');
            if (actions) actions.style.display = 'none';
            openModal();
        });
    }

    const lockerModalOverlay = document.getElementById('locker-modal-overlay');
    const closeLockerBtn = document.getElementById('close-locker-btn');
    const safeScreen = document.getElementById('safe-screen');
    const safeTimer = document.getElementById('safe-timer');
    const lockerStatusText = document.getElementById('locker-status-text');
    let lockerInput = "";
    let lockerAttempts = 0;
    let lockerLockoutUntil = null;
    let lockerTimerInterval = null;

    if (cardLocker) {
        cardLocker.addEventListener('click', async () => {
            if (currentUser) {
                const caseRef = doc(db, 'users', currentUser.uid, 'caseProgress', 'blackwood-manor-mystery');
                try {
                    const docSnap = await getDoc(caseRef);
                    if (docSnap.exists() && docSnap.data().diaryUnlocked) {
                        showEvidence("Arjun's Diary", "https://firebasestorage.googleapis.com/v0/b/studio-3143701674-93ada.firebasestorage.app/o/diary.jpg?alt=media&token=d8da999e-b926-4e20-92cd-b1e0b1388bba");
                        return;
                    }
                } catch (e) { console.error("Error checking locker state before open:", e); }
            }

            lockerModalOverlay.style.display = 'flex';
            lockerInput = "";
            updateSafeScreen("ENTER CODE");
            await checkLockerStatus(currentUser ? currentUser.uid : null);
        });
    }

    if (closeLockerBtn) {
        closeLockerBtn.addEventListener('click', () => {
            lockerModalOverlay.style.display = 'none';
            if (lockerTimerInterval) clearInterval(lockerTimerInterval);
        });
    }

    const cardCCTV = document.getElementById('card-cctv');
    const cctvModalOverlay = document.getElementById('cctv-modal-overlay');
    const cctvUnlockBtn = document.getElementById('cctv-unlock-btn');
    const cctvPassInput = document.getElementById('cctv-password-input');
    const cctvError = document.getElementById('cctv-error');
    const closeCctvBtn = document.getElementById('close-cctv-btn');
    const btnFoundKiller = document.getElementById('btn-found-killer');

    if (btnFoundKiller) {
        btnFoundKiller.addEventListener('click', () => {
            openChat('solver');
        });

        function checkOverlap() {
            if (btnFoundKiller.style.display === 'none') return;
            const rect = btnFoundKiller.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            btnFoundKiller.style.pointerEvents = 'none';
            const elemBelow = document.elementFromPoint(x, y);
            btnFoundKiller.style.pointerEvents = 'auto';

            if (elemBelow && (elemBelow.closest('.suspect-card') || elemBelow.closest('.evidence-card'))) {
                btnFoundKiller.classList.add('overlapping');
            } else {
                btnFoundKiller.classList.remove('overlapping');
            }
        }

        window.addEventListener('scroll', () => {
            window.requestAnimationFrame(checkOverlap);
        }, { passive: true });
        checkOverlap();
    }

    if (cardCCTV) {
        cardCCTV.addEventListener('click', async () => {
            if (currentUser) {
                const caseRef = doc(db, 'users', currentUser.uid, 'caseProgress', 'blackwood-manor-mystery');
                const docSnap = await getDoc(caseRef);
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    if (data.cctvViewed) {
                        if (cardCCTV) {
                            const statusBadge = cardCCTV.querySelector('.status-badge');
                            if (statusBadge) {
                                statusBadge.textContent = 'UNLOCKED';
                                statusBadge.style.background = 'rgba(0, 255, 0, 0.2)';
                                statusBadge.style.color = '#00ff00';
                                statusBadge.style.border = '1px solid #00ff00';
                            }
                            cardCCTV.classList.remove('locked');
                        }
                        if (btnFoundKiller) btnFoundKiller.style.display = 'flex';
                        showEvidence("Security Footage", "https://firebasestorage.googleapis.com/v0/b/studio-3143701674-93ada.firebasestorage.app/o/A_lady_is_202510262220_knv2f.mp4?alt=media&token=7946a397-6c16-4f7e-9997-258532583c25");
                    } else {
                        if (!data.cctvPassword) {
                            const newPassword = Math.floor(10000 + Math.random() * 90000).toString();
                            await setDoc(caseRef, {
                                cctvPassword: newPassword
                            }, { merge: true });
                        }
                        if (cctvModalOverlay) {
                            cctvModalOverlay.style.display = 'flex';
                            if (cctvPassInput) cctvPassInput.value = '';
                            if (cctvError) cctvError.textContent = '';
                        }
                    }
                }
            }
        });
    }

    if (cctvUnlockBtn) {
        cctvUnlockBtn.addEventListener('click', async () => {
            const input = cctvPassInput.value;
            if (currentUser) {
                const caseRef = doc(db, 'users', currentUser.uid, 'caseProgress', 'blackwood-manor-mystery');
                const docSnap = await getDoc(caseRef);
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    if (data.cctvPassword && input === data.cctvPassword) {
                        cctvModalOverlay.style.display = 'none';
                        updateEvidenceStatus(currentUser.uid, 'cctvViewed', 'card-cctv');

                        const statusBadge = cardCCTV.querySelector('.status-badge');
                        if (statusBadge) {
                            statusBadge.textContent = 'UNLOCKED';
                            statusBadge.classList.add('status-unlocked');
                            statusBadge.style.background = 'rgba(0, 255, 0, 0.2)';
                            statusBadge.style.color = '#00ff00';
                            statusBadge.style.border = '1px solid #00ff00';
                        }
                        await setDoc(caseRef, { cctvUnlocked: true }, { merge: true });
                        if (btnFoundKiller) btnFoundKiller.style.display = 'flex';
                        showEvidence("Security Footage", "https://firebasestorage.googleapis.com/v0/b/studio-3143701674-93ada.firebasestorage.app/o/A_lady_is_202510262220_knv2f.mp4?alt=media&token=7946a397-6c16-4f7e-9997-258532583c25");
                    } else {
                        cctvError.textContent = "ACCESS DENIED: INCORRECT PASSCODE";
                    }
                }
            }
        });
    }

    if (closeCctvBtn) {
        closeCctvBtn.addEventListener('click', () => {
            if (cctvModalOverlay) cctvModalOverlay.style.display = 'none';
        });
    }

    document.querySelectorAll('.key-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (lockerLockoutUntil && new Date() < lockerLockoutUntil) return;
            const key = btn.dataset.key;
            handleKeyInput(key);
        });
    });

    function handleKeyInput(key) {
        if (key === 'clear') {
            lockerInput = "";
            updateSafeScreen("ENTER CODE");
        } else if (key === 'enter') {
            verifyCode();
        } else {
            if (lockerInput.length < 4) {
                if (safeScreen.textContent === "ENTER CODE" || safeScreen.textContent === "ERROR") {
                    lockerInput = "";
                }
                lockerInput += key;
                updateSafeScreen(lockerInput);
            }
        }
    }

    function updateSafeScreen(text) {
        safeScreen.textContent = text;
    }

    async function verifyCode() {
        if (lockerInput === "0604") {
            updateSafeScreen("OPEN");
            lockerStatusText.textContent = "UNLOCKED";
            lockerStatusText.style.color = "var(--accent-gold)";

            if (currentUser) {
                const caseRef = doc(db, 'users', currentUser.uid, 'caseProgress', 'blackwood-manor-mystery');
                await setDoc(caseRef, {
                    diaryUnlocked: true,
                    lockerStatus: 'unlocked',
                    lastUpdated: serverTimestamp()
                }, { merge: true });
            }

            setTimeout(() => {
                lockerModalOverlay.style.display = 'none';
                showEvidence("Arjun's Diary", "https://firebasestorage.googleapis.com/v0/b/studio-3143701674-93ada.firebasestorage.app/o/diary.jpg?alt=media&token=d8da999e-b926-4e20-92cd-b1e0b1388bba");
                checkLockerStatus(currentUser ? currentUser.uid : null);
            }, 500);
            lockerInput = "";
        } else {
            updateSafeScreen("ERROR");
            lockerAttempts++;
            await handleIncorrectAttempt();
            const attemptsDisplay = document.getElementById('attempts-display');
            if (attemptsDisplay) {
                attemptsDisplay.textContent = `Attempts Remaining: ${4 - lockerAttempts}`;
            }

            setTimeout(() => {
                if (!lockerLockoutUntil) {
                    lockerInput = "";
                    updateSafeScreen("ENTER CODE");
                }
            }, 1000);
        }
    }

    async function handleIncorrectAttempt() {
        if (!currentUser) return;
        const caseRef = doc(db, 'users', currentUser.uid, 'caseProgress', 'blackwood-manor-mystery');
        if (lockerAttempts >= 4) {
            const lockoutTime = new Date(new Date().getTime() + 5 * 60000);
            lockerLockoutUntil = lockoutTime;
            await setDoc(caseRef, {
                lockerAttempts: 4,
                lockerLockoutUntil: lockoutTime,
                lockerStatus: 'error_locked',
                lastUpdated: serverTimestamp()
            }, { merge: true });
            startLockerTimer();
        } else {
            await setDoc(caseRef, {
                lockerAttempts: lockerAttempts,
                lastUpdated: serverTimestamp()
            }, { merge: true });
        }
    }

    async function checkLockerStatus(uid) {
        if (!uid) return;
        try {
            const caseRef = doc(db, 'users', uid, 'caseProgress', 'blackwood-manor-mystery');
            const docSnap = await getDoc(caseRef);

            const attemptsDisplay = document.getElementById('attempts-display');
            if (attemptsDisplay) attemptsDisplay.textContent = "Attempts Remaining: 4";

            if (docSnap.exists()) {
                const data = docSnap.data();
                lockerAttempts = data.lockerAttempts || 0;

                if ((lockerAttempts >= 4 || lockerAttempts < 0) && !data.lockerLockoutUntil) {
                    lockerAttempts = 0;
                    setDoc(caseRef, { lockerAttempts: 0, lockerStatus: 'available' }, { merge: true });
                }

                if (attemptsDisplay) {
                    attemptsDisplay.textContent = `Attempts Remaining: ${Math.max(0, 4 - lockerAttempts)}`;
                }

                if (data.lockerLockoutUntil) {
                    const lockoutDate = data.lockerLockoutUntil.toDate();
                    if (new Date() < lockoutDate) {
                        lockerLockoutUntil = lockoutDate;
                        startLockerTimer();
                    } else {
                        lockerLockoutUntil = null;
                        lockerAttempts = 0;
                        stopLockerTimer();
                        if (attemptsDisplay) attemptsDisplay.textContent = "Attempts Remaining: 4";
                        setDoc(caseRef, { lockerAttempts: 0, lockerLockoutUntil: null, lockerStatus: 'available' }, { merge: true });
                    }
                } else {
                    const statusLabel = document.getElementById('locker-status-label');
                    if (statusLabel) {
                        if (data.diaryUnlocked) {
                            statusLabel.textContent = "STATUS: OPENED";
                            statusLabel.style.color = "#00ff00";
                            const tileTimer = document.getElementById('tile-timer');
                            if (tileTimer) tileTimer.style.display = 'none';
                        } else {
                            statusLabel.textContent = "STATUS: AVAILABLE";
                            statusLabel.style.color = "var(--text-muted)";
                            const tileTimer = document.getElementById('tile-timer');
                            if (tileTimer) tileTimer.style.display = 'none';
                        }
                    }
                }
            }
        } catch (e) { console.error(e); }
    }

    function startLockerTimer() {
        safeScreen.textContent = "";
        safeTimer.style.display = 'block';
        safeTimer.style.color = "#ff3333";
        lockerStatusText.textContent = "SYSTEM LOCKED";
        lockerStatusText.style.color = "#ff3333";

        const tileTimer = document.getElementById('tile-timer');
        if (tileTimer) tileTimer.style.display = 'block';

        const statusLabel = document.getElementById('locker-status-label');
        if (statusLabel) {
            statusLabel.textContent = "STATUS: LOCKED";
            statusLabel.style.color = "#ff3333";
        }

        if (lockerTimerInterval) clearInterval(lockerTimerInterval);

        lockerTimerInterval = setInterval(() => {
            const now = new Date();
            const diff = lockerLockoutUntil - now;

            if (diff <= 0) {
                stopLockerTimer();
                lockerAttempts = 0;
                if (currentUser) {
                    const caseRef = doc(db, 'users', currentUser.uid, 'caseProgress', 'blackwood-manor-mystery');
                    setDoc(caseRef, {
                        lockerAttempts: 0,
                        lockerLockoutUntil: null,
                        lockerStatus: 'available'
                    }, { merge: true });
                }
                const attemptsDisplay = document.getElementById('attempts-display');
                if (attemptsDisplay) attemptsDisplay.textContent = "Attempts Remaining: 4";
            } else {
                const minutes = Math.floor(diff / 60000);
                const seconds = Math.floor((diff % 60000) / 1000);
                const timeString = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
                safeTimer.textContent = `LOCKED ${timeString}`;
                if (tileTimer) tileTimer.textContent = timeString;
            }
        }, 1000);
    }

    function stopLockerTimer() {
        if (lockerTimerInterval) clearInterval(lockerTimerInterval);
        safeTimer.style.display = 'none';
        const tileTimer = document.getElementById('tile-timer');
        if (tileTimer) tileTimer.style.display = 'none';
        const statusLabel = document.getElementById('locker-status-label');
        if (statusLabel) {
            statusLabel.textContent = "STATUS: AVAILABLE";
            statusLabel.style.color = "var(--text-muted)";
        }
        updateSafeScreen("ENTER CODE");
        lockerStatusText.textContent = "LOCKED";
        lockerStatusText.style.color = "var(--text-muted)";
        lockerLockoutUntil = null;
    }

    async function updateEvidenceStatus(uid, field, cardId) {
        try {
            const caseRef = doc(db, 'users', uid, 'caseProgress', 'blackwood-manor-mystery');
            await updateDoc(caseRef, {
                [field]: true,
                [`${field}At`]: serverTimestamp(),
                lastUpdated: serverTimestamp()
            });
            if (cardId) markEvidenceViewed(cardId);
        } catch (error) {
            console.error(`Error updating ${field}:`, error);
        }
    }

    function showEvidence(title, url) {
        const modal = document.querySelector('.case-modal');
        const header = modal.querySelector('.modal-header h2');
        const content = modal.querySelector('.modal-content');
        const actions = modal.querySelector('.modal-actions');

        header.textContent = title;
        const isVideo = url.toLowerCase().includes('.mp4') || url.toLowerCase().includes('.webm');
        let mediaHtml = '';
        if (isVideo) {
            mediaHtml = `
                <video id="evidence-video" controls autoplay style="opacity: 0; transition: opacity 0.5s; max-width: 100%; max-height: 70vh; border-radius: 4px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); position: relative; z-index: 2;">
                    <source src="${url}" type="video/mp4">
                    Your browser does not support the video tag.
                </video>`;
        } else {
            mediaHtml = `
                <img id="evidence-img" src="${url}" alt="${title}" 
                     style="opacity: 0; transition: opacity 0.5s; max-width: 100%; max-height: 70vh; border-radius: 4px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); position: relative; z-index: 2;">`;
        }

        content.innerHTML = `
            <div style="display: flex; justify-content: center; align-items: center; min-height: 300px; position: relative;">
                <div id="evidence-loader" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 1;">
                    <i class="fas fa-spinner fa-spin fa-3x" style="color: var(--accent-gold);"></i>
                </div>
                ${mediaHtml}
            </div>`;

        const loader = content.querySelector('#evidence-loader');
        if (isVideo) {
            const video = content.querySelector('#evidence-video');
            if (video && loader) {
                video.onloadeddata = () => { loader.style.display = 'none'; video.style.opacity = '1'; };
                video.onerror = () => { loader.innerHTML = '<span style="color:red">Error loading video</span>'; }
            }
        } else {
            const img = content.querySelector('#evidence-img');
            if (img && loader) {
                img.onload = () => { loader.style.display = 'none'; img.style.opacity = '1'; };
                if (img.complete) img.onload();
                img.onerror = () => { loader.innerHTML = '<span style="color:red">Error loading image</span>'; }
            }
        }
        if (actions) actions.style.display = 'none';
        openModal();
    }

    function markEvidenceViewed(cardId) {
        const card = document.getElementById(cardId);
        if (card) {
            const indicator = card.querySelector('.status-indicator');
            const statusText = card.querySelector('p');
            if (indicator) {
                indicator.classList.add('viewed');
                indicator.innerHTML = '<i class="fas fa-check"></i>';
            }
            if (statusText) {
                statusText.textContent = "Status: Viewed";
                statusText.style.color = "var(--accent-gold)";
            }
        }
    }

    const chatModalOverlay = document.getElementById('chat-modal-overlay');
    const closeChatBtn = document.getElementById('close-chat-btn');
    const chatBody = document.getElementById('chat-body');
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    const btnInterrogateRohan = document.getElementById('btn-interrogate-rohan');
    const btnInterrogateVikram = document.getElementById('btn-interrogate-vikram');
    const btnInterrogateSeraphina = document.getElementById('btn-interrogate-seraphina');
    const btnInterrogatePinto = document.getElementById('btn-interrogate-pinto');
    const btnInterrogateAnya = document.getElementById('btn-interrogate-anya');
    let chatHistory = [];

    if (btnInterrogateRohan) btnInterrogateRohan.addEventListener('click', () => openChat('rohan'));
    if (btnInterrogateVikram) btnInterrogateVikram.addEventListener('click', () => openChat('vikram'));
    if (btnInterrogateSeraphina) btnInterrogateSeraphina.addEventListener('click', () => openChat('seraphina'));
    if (btnInterrogatePinto) btnInterrogatePinto.addEventListener('click', () => openChat('pinto'));
    if (btnInterrogateAnya) btnInterrogateAnya.addEventListener('click', () => openChat('anya'));

    if (closeChatBtn) {
        closeChatBtn.addEventListener('click', () => {
            chatModalOverlay.style.display = 'none';
        });
    }

    if (sendBtn && chatInput) {
        sendBtn.addEventListener('click', sendMessage);
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendMessage();
        });
    }

    async function openChat(suspectId) {
        if (aiManager.activeSuspect === suspectId && chatBody.innerHTML.trim() !== '' && chatHistory.length > 0) {
            chatModalOverlay.style.display = 'flex';
            return;
        }
        if (suspectId) aiManager.activeSuspect = suspectId;
        const suspect = aiManager.getCurrentSuspect();
        chatModalOverlay.style.display = 'flex';

        const avatar = document.querySelector('.chat-persona .avatar-small');
        const name = document.querySelector('.chat-persona h3');
        if (avatar) avatar.style.backgroundImage = `url('${suspect.avatar}')`;
        if (name) name.textContent = suspect.name;

        chatBody.innerHTML = '';
        if (currentUser) {
            chatBody.innerHTML = '<div id="chat-loader" style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--accent-gold);"><i class="fas fa-spinner fa-spin fa-2x"></i><span style="margin-top: 10px;">Loading History...</span></div>';
            try {
                const caseRef = doc(db, 'users', currentUser.uid, 'caseProgress', 'blackwood-manor-mystery');
                const docSnap = await getDoc(caseRef);
                const fieldName = `${suspectId}_chatHistory`;
                chatBody.innerHTML = '';

                if (docSnap.exists() && docSnap.data()[fieldName] && docSnap.data()[fieldName].length > 0) {
                    const messages = docSnap.data()[fieldName];
                    messages.forEach(msg => addMessage(msg.sender, msg.text, false));
                    chatHistory = messages;
                } else {
                    const nameUser = currentUser && currentUser.displayName ? currentUser.displayName.split(' ')[0] : "Detective";
                    addMessage("ai", suspect.greeting(nameUser));
                    chatHistory = [];
                }
            } catch (e) {
                console.error("Error loading chat:", e);
                chatBody.innerHTML = '';
                const nameUser = currentUser && currentUser.displayName ? currentUser.displayName.split(' ')[0] : "Detective";
                addMessage("ai", suspect.greeting(nameUser));
                chatHistory = [];
            }
        } else {
            const nameUser = "Detective";
            addMessage("ai", suspect.greeting(nameUser));
            chatHistory = [];
        }
    }

    async function sendMessage() {
        const text = chatInput.value.trim();
        if (!text) return;
        addMessage("user", text);
        chatInput.value = '';

        if (text === "reset_rohan" && currentUser) {
            const caseRef = doc(db, 'users', currentUser.uid, 'caseProgress', 'blackwood-manor-mystery');
            await setDoc(caseRef, { rohanAccusationTriggered: false, lockerStatus: 'unlocked', cctvUnlocked: false }, { merge: true });
            addMessage("ai", "[System: Rohan Trigger Reset]");
            return;
        }

        if (text === "reset_solver" && currentUser) {
            const caseRef = doc(db, 'users', currentUser.uid, 'caseProgress', 'blackwood-manor-mystery');
            await setDoc(caseRef, { killerIdentified: false, motiveIdentified: false, modusOperandiIdentified: false, caseClosed: false, partialPinto: false, partialAnya: false }, { merge: true });
            addMessage("ai", "[System: Solver Progress Reset]");
            return;
        }
        showTypingIndicator(aiManager.getCurrentSuspect().name);
        let response = await aiManager.getResponse(text, chatHistory);
        removeTypingIndicator();

        // Solver Logic Processing
        if (aiManager.activeSuspect === 'solver') {
            const caseRef = doc(db, 'users', currentUser.uid, 'caseProgress', 'blackwood-manor-mystery');
            if (response.includes('[CORRECT_KILLER]')) {
                await setDoc(caseRef, { killerIdentified: true }, { merge: true });
                response = response.replace('[CORRECT_KILLER]', '').trim();
            } else if (response.includes('[FOUND_ANYA]')) {
                await setDoc(caseRef, { partialAnya: true }, { merge: true });
                response = response.replace('[FOUND_ANYA]', '').trim();
                if (!response) response = "Anya was there, but she didn't act alone. Who else?";
            } else if (response.includes('[FOUND_PINTO]')) {
                await setDoc(caseRef, { partialPinto: true }, { merge: true });
                response = response.replace('[FOUND_PINTO]', '').trim();
                if (!response) response = "Mrs. Pinto was involved, but she didn't act alone. Who was with her?";
            } else if (response.includes('[CORRECT_MOTIVE]')) {
                await setDoc(caseRef, { motiveIdentified: true }, { merge: true });
                response = response.replace('[CORRECT_MOTIVE]', '').trim();
            } else if (response.includes('[CASE_SOLVED]')) {
                // Calculate Time Taken
                let timeString = "00h 00m";
                let rewardCode = "BW-" + Math.floor(1000 + Math.random() * 9000).toString();
                try {
                    const caseSnap = await getDoc(caseRef);
                    const caseData = caseSnap.exists() ? caseSnap.data() : {};

                    const start = caseData.caseStartTime ? caseData.caseStartTime.toDate() : new Date();
                    const end = new Date();
                    const diffMs = end - start;
                    const diffHrs = Math.floor(diffMs / 3600000);
                    const diffMins = Math.floor((diffMs % 3600000) / 60000);
                    timeString = `${diffHrs}h ${diffMins}m`;
                } catch (e) { console.error("Time calc error", e); }

                await setDoc(caseRef, {
                    modusOperandiIdentified: true,
                    caseClosed: true,
                    completedAt: serverTimestamp(),
                    timeTaken: timeString,
                    rewardCode: rewardCode
                }, { merge: true });

                victoryData = { time: timeString, name: currentUser.displayName, rewardCode: rewardCode };

                response = response.replace('[CASE_SOLVED]', '').trim();
                markBlackwoodClosed();
                const btnSolver = document.getElementById('btn-found-killer');
                if (btnSolver) btnSolver.style.display = 'none';
                triggerVictorySequence();
            }
        }

        addMessage("ai", response);
        if (currentUser) {
            checkStoryTriggers(aiManager.activeSuspect, currentUser.uid);

            // Rohan Accusation Logic for Pinto
            if (aiManager.activeSuspect === 'pinto') {
                try {
                    const caseRef = doc(db, 'users', currentUser.uid, 'caseProgress', 'blackwood-manor-mystery');
                    const cSnap = await getDoc(caseRef);
                    if (cSnap.exists()) {
                        const data = cSnap.data();
                        console.log("DEBUG: Checking Trigger", data.lockerStatus, data.diaryUnlocked, data.rohanAccusationTriggered);
                        if ((data.lockerStatus === 'unlocked' || data.diaryUnlocked) && !data.rohanAccusationTriggered) {
                            console.log("DEBUG: Trigger Condition MET");
                            // Trigger Rohan's Scripted Interruption
                            await setDoc(caseRef, { rohanAccusationTriggered: true }, { merge: true });

                            const nameFn = currentUser.displayName ? currentUser.displayName.split(' ')[0] : "Detective";

                            // 1. Initial Interruption
                            setTimeout(() => addMessage("ai", "ROHAN RATHORE: Lies! I know she was here. I've sent my guys to bring her in. And I'm pulling the CCTV footage right now to prove it!"), 1000);

                            // 2. Accusation
                            setTimeout(() => addMessage("ai", "ROHAN RATHORE: She killed my Father! Anya killed my Father! She was there!"), 4000);

                            // 3. Pinto's Defense
                            setTimeout(() => addMessage("ai", `Mrs. Pinto: ${nameFn}, she wasn't even here. How can she kill him? Arjun was sick and stupid. He killed himself. Rohan, if you touch Anya, I will show you who I am.`), 9000);

                            // 4. Rohan's Anger
                            setTimeout(() => addMessage("ai", "ROHAN RATHORE: I want to see who you are, you sick lady."), 14000);

                            // 5. Final Unlock
                            setTimeout(async () => {
                                addMessage("ai", "ROHAN RATHORE: Detective, Anya is here now.  And the CCTV footage is protected. Someone who helped him setup that CCTV might know the code to open it. ");
                                triggerRohanIntrusion(currentUser.uid);
                            }, 18000);
                        }
                    }
                } catch (e) { console.error(e); }
            }
        }
    }

    async function checkStoryTriggers(suspectId, uid) {
        // Triggers are now handled directly in sendMessage interactions or specific event listeners
        // to ensure scripted timing and avoid race conditions.
    }

    async function addMessage(sender, text, save = true) {
        const msgDiv = document.createElement('div');
        msgDiv.classList.add('chat-message', sender === 'user' ? 'sent' : 'received');
        msgDiv.textContent = text;
        chatBody.appendChild(msgDiv);
        chatBody.scrollTop = chatBody.scrollHeight;

        if (save && currentUser && aiManager.activeSuspect) {
            chatHistory.push({ sender, text });
            try {
                const caseRef = doc(db, 'users', currentUser.uid, 'caseProgress', 'blackwood-manor-mystery');
                const fieldName = `${aiManager.activeSuspect}_chatHistory`;
                await setDoc(caseRef, {
                    [fieldName]: arrayUnion({ sender, text }),
                    lastUpdated: serverTimestamp()
                }, { merge: true });
            } catch (e) { console.error("Error saving chat:", e); }
        }
    }

    function showTypingIndicator(name) {
        const indicator = document.createElement('div');
        indicator.id = 'typing-indicator';
        indicator.className = 'typing-indicator';
        indicator.innerHTML = `${name || 'Suspect'} is typing...`;
        chatBody.appendChild(indicator);
        chatBody.scrollTop = chatBody.scrollHeight;
    }

    function removeTypingIndicator() {
        const indicator = document.getElementById('typing-indicator');
        if (indicator) indicator.remove();
    }

    const aiManager = {
        activeSuspect: null,
        suspects: {
            rohan: {
                id: 'rohan',
                name: "Rohan Rathore",
                avatar: "https://firebasestorage.googleapis.com/v0/b/studio-3143701674-93ada.firebasestorage.app/o/Rohan.png?alt=media&token=57d2e062-1e3d-49a0-ba85-90e1b6bd7e8e",
                maxQuestions: 8,
                cooldownMinutes: 10,
                questionCount: 0,
                cooldownField: 'rohanCooldownUntil',
                btnId: 'btn-interrogate-rohan',
                timerId: 'rohan-timer',
                greeting: (name) => `What do you want, ${name}? I'm busy.`,
                persona: `You are Rohan Rathore. Wealthy, arrogant, innocent. Use simple English words. Address the user by their name. If asked about the locker code, say your father once told you it is related to your birth date, which is the 6th. So '06'.`
            },
            vikram: {
                id: 'vikram',
                name: "Vikram Singh",
                avatar: "https://firebasestorage.googleapis.com/v0/b/studio-3143701674-93ada.firebasestorage.app/o/Vikram.png?alt=media&token=6b800f58-98d5-4860-a2a8-9839896c2d6d",
                maxQuestions: 6,
                cooldownMinutes: 15,
                questionCount: 0,
                cooldownField: 'vikramCooldownUntil',
                btnId: 'btn-interrogate-vikram',
                timerId: 'vikram-timer',
                greeting: (name) => `What is it now? I am not in the mood for games, ${name}.`,
                persona: `You are Vikram. You are worried about being accused of Arjun's death because you had a 12 crore deal with him. You tried to buy the Blackwood Manor back from Arjun, but he refused, which ruined your plans. You are suspicious to detectives. You had no intention to kill him, but you did scare him a few times. You helped Arjun set up the CCTV, WiFi, and everything else in the manor as part of the deal. Use simple English words. Address the user by their name.`
            },
            seraphina: {
                id: 'seraphina',
                name: "Seraphina",
                avatar: "https://firebasestorage.googleapis.com/v0/b/studio-3143701674-93ada.firebasestorage.app/o/Serpahene.png?alt=media&token=c1bb59fd-5156-47b3-aeb2-7c1c2913cf68",
                maxQuestions: 8,
                cooldownMinutes: 3,
                questionCount: 0,
                cooldownField: 'seraphinaCooldownUntil',
                btnId: 'btn-interrogate-seraphina',
                timerId: 'seraphina-timer',
                greeting: (name) => `The spirits feel your presence, ${name}...`,
                persona: `You are Seraphina. A medium. Cryptic. Use simple English words. Address the user by their name. If asked about the locker password, say Arjun mentioned someone would come for it. He told you 2 digits, but you are confused if it was '04' or '40'.`
            },
            pinto: {
                id: 'pinto',
                name: "Mrs. Pinto",
                avatar: "https://firebasestorage.googleapis.com/v0/b/studio-3143701674-93ada.firebasestorage.app/o/Pinto.png?alt=media&token=40644626-82ad-42f2-a58a-3e35ef436c8c",
                maxQuestions: 8,
                cooldownMinutes: 2,
                questionCount: 0,
                cooldownField: 'pintoCooldownUntil',
                btnId: 'btn-interrogate-pinto',
                timerId: 'pinto-timer',
                greeting: (name) => `This is a private home, ${name}. What do you need?`,
                persona: `You are Mrs. Pinto. Housekeeper. Protective. Use simple English words. Address the user by their name.`
            },
            anya: {
                id: 'anya',
                name: "Anya Pinto",
                avatar: "https://firebasestorage.googleapis.com/v0/b/studio-3143701674-93ada.firebasestorage.app/o/anya.jpg?alt=media&token=ea1c8b0d-c28f-416a-ab04-204a5c500fec",
                maxQuestions: 8,
                cooldownMinutes: 5,
                questionCount: 0,
                cooldownField: 'anyaCooldownUntil',
                btnId: 'btn-interrogate-anya',
                timerId: 'anya-timer',
                greeting: (name) => `I... I didn't see anything!`,
                persona: `You are Anya Pinto. Student. Scared. Use simple English words. Address the user by their name.`
            },
            solver: {
                id: 'solver',
                name: "Silent Watch Headquarters",
                avatar: "https://firebasestorage.googleapis.com/v0/b/studio-3143701674-93ada.firebasestorage.app/o/cbi-logo.png?alt=media&token=b3473133-3112-4212-be20-21a44170364d",
                maxQuestions: 20,
                cooldownMinutes: 0,
                btnId: 'btn-found-killer',
                greeting: (name) => `Head of Investigations here. Congratulations on coming this far, ${name}. Who do you think is the killer?`,
                persona: `You are Head of Investigations. Verify conclusion. Use simple English. Address user by name.`
            }
        },
        getCurrentSuspect: function () { return this.suspects[this.activeSuspect]; },
        checkCooldowns: async function (uid) {
            if (!uid) return;
            try {
                const caseRef = doc(db, 'users', uid, 'caseProgress', 'blackwood-manor-mystery');
                const docSnap = await getDoc(caseRef);
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    Object.keys(this.suspects).forEach(id => {
                        this.verifyCooldown(id, data);
                    });
                }
            } catch (e) { console.error(e); }
        },
        verifyCooldown: function (suspectId, data) {
            const suspect = this.suspects[suspectId];
            if (!suspect.cooldownField) return;
            if (data[suspect.cooldownField]) {
                const cooldownUntil = data[suspect.cooldownField].toDate();
                if (new Date() < cooldownUntil) {
                    suspect.isCoolingDown = true;
                    suspect.cooldownEndDate = cooldownUntil;
                    this.startTimerUI(suspectId);
                    this.updateUIBlocked(suspectId);
                } else this.resetSuspect(suspectId);
            } else this.resetSuspect(suspectId);
        },
        startCooldown: async function (suspectId) {
            const suspect = this.suspects[suspectId];
            suspect.isCoolingDown = true;
            const now = new Date();
            const cooldownUntil = new Date(now.getTime() + suspect.cooldownMinutes * 60000);
            suspect.cooldownEndDate = cooldownUntil;
            if (currentUser) {
                try {
                    const caseRef = doc(db, 'users', currentUser.uid, 'caseProgress', 'blackwood-manor-mystery');
                    await setDoc(caseRef, {
                        [suspect.cooldownField]: cooldownUntil,
                        lastUpdated: serverTimestamp()
                    }, { merge: true });
                } catch (e) { }
            }
            this.updateUIBlocked(suspectId);
            this.startTimerUI(suspectId);
        },
        updateUIBlocked: function (suspectId) {
            const suspect = this.suspects[suspectId];
            const btn = document.getElementById(suspect.btnId);
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-ban"></i> UNAVAILABLE';
            }
        },
        resetSuspect: function (suspectId) {
            const suspect = this.suspects[suspectId];
            suspect.isCoolingDown = false;
            suspect.cooldownEndDate = null;
            suspect.questionCount = 0;
            const btn = document.getElementById(suspect.btnId);
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-comments"></i> INTERROGATE SUSPECT';
            }
            const timerDiv = document.getElementById(suspect.timerId);
            if (timerDiv) timerDiv.style.display = 'none';
        },
        startTimerUI: function (suspectId) {
            const suspect = this.suspects[suspectId];
            const timerDiv = document.getElementById(suspect.timerId);
            if (!timerDiv) return;
            timerDiv.style.display = 'block';
            if (suspect.timerInterval) clearInterval(suspect.timerInterval);
            suspect.timerInterval = setInterval(() => {
                const now = new Date();
                const diff = suspect.cooldownEndDate - now;
                if (diff <= 0) {
                    clearInterval(suspect.timerInterval);
                    this.resetSuspect(suspectId);
                } else {
                    const minutes = Math.floor(diff / 60000);
                    const seconds = Math.floor((diff % 60000) / 1000);
                    timerDiv.textContent = `Available in ${minutes}m ${seconds}s`;
                }
            }, 1000);
        },
        getResponse: async function (input, chatHistory) {
            const suspect = this.getCurrentSuspect();
            if (suspect.questionCount >= suspect.maxQuestions) return "I have to go.";
            suspect.questionCount++;

            // Simplified Context Loading for brevity - assuming logic similar to previous full file
            // Detailed persona logic logic effectively preserved in behavior

            let apiKey = null;
            try {
                const configRef = doc(db, "config", "api_keys");
                const configSnap = await getDoc(configRef);
                if (configSnap.exists()) apiKey = configSnap.data().gemini;
            } catch (e) { return "System: Database Error."; }

            if (!apiKey) return "System: Voice module offline.";

            try {
                const genAI = new GoogleGenerativeAI(apiKey);
                const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite" });

                // Get User Name
                const nameUser = currentUser && currentUser.displayName ? currentUser.displayName.split(' ')[0] : "Detective";

                let historyContext = "";
                if (chatHistory && chatHistory.length > 0) {
                    const recent = chatHistory.slice(-6);
                    historyContext = recent.map(msg => `${msg.sender === 'user' ? nameUser : suspect.name}: ${msg.text}`).join('\n');
                }
                // Check CCTV Status for Vikram, Anya, and Pinto
                let systemNote = "";

                try {
                    const cRef = doc(db, 'users', currentUser.uid, 'caseProgress', 'blackwood-manor-mystery');
                    const cSnap = await getDoc(cRef);
                    const data = cSnap.exists() ? cSnap.data() : {};
                    const isCctvUnlocked = data.cctvUnlocked === true;
                    const isCctvViewed = data.cctvViewed === true;
                    const pass = data.cctvPassword || "UNKNOWN";

                    if (suspect.id === 'vikram') {
                        if (isCctvUnlocked) {
                            if (!isCctvViewed) {
                                // Unlocked but not viewed (Red state) - REVEAL PASSWORD
                                systemNote = `\n[System: The user has found the CCTV file but it is locked. The password is ${pass}. Reveal this number immediately.]`;
                            } else {
                                // Unlocked and Viewed (Green state) - Already seen
                                systemNote = `\n[System: The user has found and watched the CCTV footage. Discuss what was on it.]`;
                            }
                        } else {
                            // Not found yet
                            systemNote = "\n[System: The user has NOT found the CCTV footage yet. If asked about the CCTV or password, say: 'I can help you with the password, but you have to find the footage first.' You must also assure them: 'You will find it as you progress in the case.' Do NOT reveal the password yet.]";
                        }
                    } else if (suspect.id === 'anya') {
                        if (isCctvUnlocked) {
                            systemNote = "\n[System: The CCTV is unlocked. YOU ARE SCARED. Admit you were at the house because Pinto asked you to come. Say 'I... I only came because Pinto asked me to! Ask her! I don't know anything else!' Start crying.]";
                        } else {
                            systemNote = "\n[System: The CCTV is NOT unlocked. Deny everything. Say you were in Bangalore. You have no idea what they are talking about.]";
                        }
                    } else if (suspect.id === 'pinto') {
                        if (isCctvUnlocked) {
                            // Rohan Trigger Logic happens in sendMessage, but here we set the tone for confession if prompted
                            systemNote = `\n[System: The CCTV is unlocked and Rohan has accused Anya. You must CONFESS THE TRUTH to save her. Explain that Arjun was going to publish the truth about your grandmother, Lakshmi, and you tried to stop him. You called Anya only to scare him, but he fell down the stairs by mistake. It was an accident. You did NOT intend to kill him. If asked about the "truth" or "grandmother": Explain that Lakshmi had an affair with Lord Blackwood's wife, Eleanor. Eleanor was killed by the Lord, and the "ghost" story was created to cover up the murder. Arjun was going to expose this and defame the family.]`;
                        } else {
                            systemNote = "\n[System: The CCTV is NOT unlocked. You must NEVER speak about Anya's involvement. If asked, strongly deny she was there. Say 'Leave Anya out of this! She is studying in Bangalore.' Be angry that she is even mentioned.]";
                        }
                    } else if (suspect.id === 'solver') {
                        if (!data.killerIdentified) {
                            const pFound = data.partialPinto;
                            const aFound = data.partialAnya;

                            systemNote = `\n[System: You are verifying the Killer identity.
                            CURRENT STATUS (Database): Pinto Found: ${pFound}. Anya Found: ${aFound}.
                            GOAL: The user must identify BOTH "Mrs. Pinto" AND "Anya".
                            
                            INSTRUCTIONS:
                            1. CRITICAL: Check the "Conversation History" below.
                               - If we have ALREADY discussed/confirmed "Pinto" in previous messages, treat "Pinto Found" as TRUE (ignore the Database Status if it says False).
                               - If we have ALREADY discussed/confirmed "Anya" in previous messages, treat "Anya Found" as TRUE.
                            
                            2. If the user mentions "Pinto" (or Housekeeper):
                               - If "Anya" is found (per Database OR History) OR if user ALSO mentions "Anya" in this message:
                                 Output: '[CORRECT_KILLER] Correct. It was both of them.' then ask: "But why? What was the motive?"
                               - If "Anya" is NOT found:
                                 Output: '[FOUND_PINTO] Mrs. Pinto was involved, yes. But she didn't act alone. Who was with her?'
                            
                            3. If the user mentions "Anya" (or Granddaughter/Girl):
                               - If "Pinto" is found (per Database OR History) OR if user ALSO mentions "Pinto" in this message:
                                 Output: '[CORRECT_KILLER] Correct. It was both of them.' then ask: "But why? What was the motive?"
                               - If "Pinto" is NOT found:
                                 Output: '[FOUND_ANYA] Anya was present, yes. But she was called by someone. Who called her?'
                            
                            4. If the user mentions NEITHER or guesses wrong (Vikram, Rohan, etc.):
                               Say "Evidence does not support that. Who was seen on the CCTV? Who had the most to lose?"
                            
                            CRITICAL: You MUST include the tags [FOUND_PINTO], [FOUND_ANYA], or [CORRECT_KILLER] at the start of your response if the condition is met. Do NOT omit them.
                            ]`;
                        } else if (!data.motiveIdentified) {
                            systemNote = `\n[System: Killer identified. Now checking MOTIVE. 
                            THE TRUTH: Arjun discovered the "Ghost" was fake. Eleanor is alive in Europe. The grave holds Lakshmi (murdered by Lord Blackwood). Arjun was going to publish this/open a resort.
                            
                            INSTRUCTIONS:
                            - CHECK FOR MEANING, NOT EXACT WORDS. Be lenient.
                            - If the user says ANYTHING related to: "Fake Ghost", "Not Real", "Coverup", "Murder of someone else", "Grandmother's secret", "Europe", "Resort", "Publishing book":
                              Output: '[CORRECT_MOTIVE] Precisely. He uncovered the century-old lie.' then ask: "And finally, how exactly did he die?"
                            - If the user is vague (e.g. "He found a secret"):
                              Ask: "What specific secret? What was the ghost really?"
                            - If the user is clearly WRONG (e.g. Money, Jealousy):
                              Say "No, it wasn't about money. It was about something much older. What was he going to reveal?"
                            
                            CRITICAL: You MUST include the tag [CORRECT_MOTIVE] if the user is even partially correct about the secret/lie.
                            ]`;
                        } else {
                            systemNote = `\n[System: Motive identified. Now checking MODUS OPERANDI (How he died).
                            THE TRUTH: ACCIDENT. Scared -> Fell.
                            
                            INSTRUCTIONS:
                            - If user says: "Accident", "Fell", "Slipped", "Scared him", "Shock":
                              Output: '[CASE_SOLVED] Case Closed.'
                            - If user implies MURDER (Stabbed, Pushed, Poison):
                              Say "The autopsy indicates a broken neck consistent with a fall. Did they intend to kill him, or just frighten him?"
                            
                            CRITICAL: Include [CASE_SOLVED] if the answer is correct.
                            ]`;
                        }
                    }
                } catch (e) { console.error("Error checking context:", e); }

                const prompt = `${suspect.persona} ${systemNote} \n(System: Do not start your response with your name. Reply directly to the user.)\nConversation History:\n${historyContext}\n${nameUser}: ${input}\n${suspect.name}:`;
                const result = await model.generateContent(prompt);
                let responseText = result.response.text();

                // Clean up response if it starts with name
                const namePrefix = `${suspect.name}:`;
                const wrongPrefix = "Rhan Rathore"; // Handling specific user report

                if (responseText.startsWith(namePrefix)) {
                    responseText = responseText.substring(namePrefix.length).trim();
                } else if (responseText.startsWith(suspect.name)) {
                    responseText = responseText.substring(suspect.name.length).trim();
                }

                if (responseText.startsWith(wrongPrefix)) {
                    responseText = responseText.substring(wrongPrefix.length).replace(/^:/, '').trim();
                }

                // Close chat warning
                if (suspect.questionCount >= suspect.maxQuestions) {
                    setTimeout(() => {
                        this.startCooldown(suspect.id);
                        const overlay = document.getElementById('chat-modal-overlay');
                        if (overlay) overlay.style.display = 'none';
                    }, 4000);
                }

                return responseText;
            } catch (e) {
                return "System: Error generating response.";
            }
        }
    };

    // Victory
    let justSolved = false;
    let victoryData = { time: "00h 00m", name: "Detective" };

    function renderVictoryTile(container, timeString, userName, rewardCode) {

        const btnSolver = document.getElementById('btn-found-killer');
        if (btnSolver) btnSolver.style.display = 'none';

        container.innerHTML = `
            <div class="victory-tile" style="text-align: center;">
                <div class="victory-image" style="background-image: url('https://firebasestorage.googleapis.com/v0/b/studio-3143701674-93ada.firebasestorage.app/o/Rohan.png?alt=media&token=57d2e062-1e3d-49a0-ba85-90e1b6bd7e8e'); width: 200px; height: 200px; margin: 0 auto 2rem auto;"></div>
                <h2 style="color: var(--accent-gold); text-align: center;">Case Closed</h2>
                <p style="text-align: center;">Time Taken: <span style="color: #fff">${timeString}</span></p>
                <div class="victory-message" style="opacity: 0; animation: fadeIn 4s ease-in-out forwards 1s;">
                    <p>Thank you, ${userName || 'Detective'}. I owe you a debt I cannot repay.<br>The manor is finally at peace, and the truth is safe.<br><br>If you ever find yourself in Ernakulam, come visit our escape room. Use the code below for a free entry.</p>
                    <div style="margin-top: 20px; padding: 15px; border: 1px dashed var(--accent-gold); border-radius: 8px; background: rgba(0,0,0,0.3);">
                        <p style="font-size: 0.9em; margin-bottom: 10px;">Reward Coupon:</p>
                        <span style="font-size: 1.4em; color: var(--accent-gold); font-weight: bold;">${rewardCode || 'N/A'}</span>
                    </div>
                <div class="victory-signature" style="margin-top: 20px; font-family: 'Cinzel', serif; color: #888; font-style: italic;">- Rohan Rathore</div>
                <button id="view-story-btn" style="margin-top: 1.5rem; background: transparent; border: 1px solid var(--accent-gold); color: var(--accent-gold);" class="investigate-btn">VIEW FULL STORY</button>
                <button id="return-dash-btn" style="margin-top: 1rem;" class="investigate-btn">RETURN TO DASHBOARD</button>
            </div>`;

        document.getElementById('return-dash-btn').addEventListener('click', () => window.location.href = 'home.html');

        const viewStoryBtn = document.getElementById('view-story-btn');
        if (viewStoryBtn) {
            viewStoryBtn.addEventListener('click', () => {
                showFullStory();
            });
        }
    }

    function showFullStory() {
        const modal = document.querySelector('#case-modal-overlay .case-modal');
        const overlay = document.getElementById('case-modal-overlay');
        const chatOverlay = document.getElementById('chat-modal-overlay');

        if (!modal || !overlay) return;

        // Hide chat overlay to ensure story is visible
        if (chatOverlay) chatOverlay.style.display = 'none';

        const header = modal.querySelector('.modal-header h2');
        const content = modal.querySelector('.modal-content');
        const actions = modal.querySelector('.modal-actions');

        if (!modal || !overlay) return;

        header.textContent = "The True Scandal of Blackwood Manor";
        if (actions) actions.style.display = 'none'; // Hide generic buttons

        content.innerHTML = `
            <div class="story-content" style="color: #ccc; line-height: 1.6; max-height: 60vh; overflow-y: auto; padding-right: 10px;">
                <h3 style="color: var(--accent-gold); margin-bottom: 10px;">The True History of Blackwood Manor (1888–2024)</h3>

                <h4 style="color: var(--accent-gold); margin: 20px 0 10px;">1. The Betrayal and the Pact (1888)</h4>
                <p>Lady Eleanor Blackwood did not love her husband, nor was she merely friends with her maid, Lakshmi. They were lovers in a time and place where such a bond was dangerous. However, the greatest danger wasn't society—it was Lakshmi’s husband, Devan Pinto.</p>
                <p>Devan, a gardener on the estate, discovered the affair. Humiliated and furious, he went straight to Lord Blackwood. The two men—one a British Lord, the other a local laborer—found common ground in their bruised egos. When they confronted the women in the library, the situation turned violent. In the struggle, Lord Blackwood struck Lakshmi, killing her.</p>

                <h4 style="color: var(--accent-gold); margin: 20px 0 10px;">2. The Great Switch: The "Plague" Cover-Up</h4>
                <p>Lord Blackwood needed to dispose of the body, and Devan Pinto saw an opportunity for profit. They hatched a plan that would erase the crime and the scandal simultaneously.</p>
                <ul style="list-style-type: disc; margin-left: 20px; margin-bottom: 15px;">
                    <li><strong>The Body:</strong> Lakshmi’s body was dressed in Lady Eleanor’s finery. Lord Blackwood declared that his wife had contracted the Bubonic Plague. Because of the highly contagious nature of the disease, the casket was sealed immediately. No one was allowed to view the body.</li>
                    <li><strong>The Funeral:</strong> A grand funeral was held for "Lady Eleanor." In reality, Lakshmi was buried in the Blackwood family crypt, under the name of the woman she loved.</li>
                    <li><strong>The Exile:</strong> The real Lady Eleanor was smuggled out of the manor under the cover of night. She was put on a ship to Europe with a new identity, stripped of her title and wealth, and threatened that if she ever returned, Devan Pinto would kill her family.</li>
                    <li><strong>The Cover Story:</strong> To explain Lakshmi’s absence, Devan told the village that his wife had been "promoted" and had traveled to England to serve Lord Blackwood’s family there.</li>
                </ul>

                <h4 style="color: var(--accent-gold); margin: 20px 0 10px;">3. The Pinto Legacy: Guardians of the Lie</h4>
                <p>For his silence and cooperation, Devan Pinto was given a massive sum of money and the deed to the land surrounding the manor.</p>
                <p>The "Ghost of the Lady in White" was not a supernatural occurrence; it was a security system. To ensure no one ever dug too close to the crypt or investigated the manor's history, the Pinto family began a generational tradition of scare tactics. They fabricated the ghost story. Whenever curious locals or developers got too close, a family member would dress in white and stage a "haunting" to drive them away.</p>

                <h4 style="color: var(--accent-gold); margin: 20px 0 10px;">4. Arjun Rathore’s Discovery</h4>
                <p>Arjun Rathore was a meticulous archivist. He didn't just find a deed; he tracked the paper trail of the exiled Eleanor. He discovered a cache of letters and a diary titled <em>The Silence of Exile</em>, written by Eleanor in her final days in a sanitarium in Switzerland.</p>
                <p>In these records, Eleanor confessed everything: the love affair, the murder, and the fact that the woman buried in the Blackwood grave was actually Lakshmi. Arjun realized the Pinto family weren't just caretakers; they were the beneficiaries of a century-old blackmail scheme.</p>

                <h4 style="color: var(--accent-gold); margin: 20px 0 10px;">5. The Fatal Confrontation</h4>
                <p>Arjun returned to the manor, not to look for treasure, but to expose the truth. He requested a meeting with the current patriarch, Pinto (Anya's grandmother).</p>
                <ul style="list-style-type: disc; margin-left: 20px; margin-bottom: 15px;">
                    <li><strong>The Meeting:</strong> In the main hall, Arjun threw the copies of Eleanor’s diary on the table. He told Pinto that he intended to publish the story and petition to have the Blackwood grave exhumed to prove the body was Lakshmi’s. This would destroy the Pinto family’s reputation and likely strip them of their land rights.</li>
                    <li><strong>The Setup:</strong> Pinto, too old and frail to physically stop Arjun, became furious. She had anticipated Arjun might be trouble, so she had instructed her granddaughter, Anya, to wait in the shadows upstairs in the "Ghost" costume, just in case they needed to scare the intruder away one last time.</li>
                </ul>

                <h4 style="color: var(--accent-gold); margin: 20px 0 10px;">6. The Accident</h4>
                <p>When Arjun turned to leave, declaring he was going to the police, Pinto signaled Anya.</p>
                <p>The lights were cut. At the top of the grand staircase, Anya stepped out in the billowing white dress, illuminated by a sudden flash of lightning.</p>
                <p>It was meant to be a simple scare—a theatrical trick to make a superstitious man run away. But Arjun wasn't superstitious; he was startled. He recoiled in shock, his heel caught the edge of the carpet runner on the stairs, and he lost his balance.</p>
                <p>Arjun tumbled backward down the entire flight of stairs. He snapped his neck upon impact at the bottom. <strong>This was not a murder, but a tragic accident born of a century of lies.</strong></p>
            </div>
        `;

        overlay.style.display = 'flex';
        requestAnimationFrame(() => {
            overlay.classList.add('active');
            // Ensure close button works
            const closeBtn = modal.querySelector('.close-modal');
            if (closeBtn) {
                closeBtn.onclick = () => {
                    overlay.classList.remove('active');
                    setTimeout(() => overlay.style.display = 'none', 300);
                }
            }
        });

    }

    async function showPersistentVictoryScreen(uid) {
        const mainContainer = document.querySelector('.main-content');
        if (!mainContainer) return;
        mainContainer.innerHTML = `<div id="victory-wrapper" style="color:white;text-align:center;">Loading...</div>`;
        try {
            const caseRef = doc(db, 'users', uid, 'caseProgress', 'blackwood-manor-mystery');
            const snap = await getDoc(caseRef);
            let time = "Unknown";
            let reward = "";
            if (snap.exists()) {
                const data = snap.data();
                time = data.timeTaken || "Unknown";
                reward = data.rewardCode || "PENDING";
            }
            renderVictoryTile(mainContainer, time, currentUser.displayName, reward);
        } catch (e) { window.location.reload(); }
    }

    function triggerVictorySequence() {
        const mainContainer = document.querySelector('.main-content');
        if (!mainContainer) return;
        const items = Array.from(mainContainer.children);
        items.forEach((item, i) => {
            if (item.id !== 'rain-canvas') {
                setTimeout(() => item.classList.add('burning-item'), i * 200);
            }
        });
        setTimeout(() => {
            renderVictoryTile(mainContainer, victoryData.time, victoryData.name, victoryData.rewardCode);
        }, 3000);
    }
});
