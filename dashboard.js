import { monitorAuthState, logoutUser, db, doc, getDoc, setDoc, updateDoc, serverTimestamp, arrayUnion } from './auth.js';
import { fetchAgents } from './agents.js';
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
        // If we ARE on index.html, we might want to auto-redirect to home if logged in?
        // User didn't ask for that, but it's standard.
        // For now, let's just make sure we don't kick them out of login page.
        monitorAuthState(
            (user) => {
                // Optional: Auto-login convenience
                // window.location.href = 'home.html'; 
                // But let's leave valid logic to auth.js or specific login script
            },
            () => {
                // Stay on login page
            }
        );
    }

    // Currently checkBlackwoodProgress is called in monitorAuthState for all pages.
    // We need to ensure that if we are on home.html, the button is found.
    // The code uses: const blackwoodCard = document.querySelector('.case-card:first-child');
    // This assumes the card exists. On home.html it should be static.
    // I will add a check to ensure we don't error out if not found, which is already there 'const btn = blackwoodCard ? ...'.
    // But I will verify if I need to explicitly re-attach listener if simpler logic fails.
    // The listener is attached inside checkBlackwoodProgress? NO.
    // The listener is attached GLOBALLY at the top level of DOMContentLoaded?
    // Let's check lines 300-315 again.
    // It is: if (blackwoodBtn) { blackwoodBtn.addEventListener ... }
    // I need to make sure blackwoodBtn is defined. It wasn't shown in the file view.
    // I'll grab it. edit or careful range)
    // Actually, replacing the top block is easy. 
    // But I need to append the function too.
    // I'll do this in two chunks if I can't see the whole file. 
    // I can see the acceptCaseBtn logic at line 240+ in previous context? No, I saw up to 230.
    // Let me just replace the acceptCaseBtn listener first.


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
                    // Case Explicitly Accepted -> In Progress
                    if (btn) {
                        btn.dataset.status = 'in-progress';
                        btn.textContent = "OPEN CASE";
                    }

                    // Check Evidence Status
                    if (data.briefingViewed) markEvidenceViewed('card-brief');
                    if (data.postmortemViewed) markEvidenceViewed('card-report');
                    if (data.layoutViewed) markEvidenceViewed('card-layout');
                    if (data.cctvViewed) {
                        markEvidenceViewed('card-cctv');
                        const btnFoundKiller = document.getElementById('btn-found-killer');
                        if (btnFoundKiller) btnFoundKiller.style.display = 'flex';
                    }
                } else {
                    // Document exists (e.g. cooldowns/locker) but case not accepted
                    if (btn) btn.dataset.status = 'new';
                }

                // Check Advanced Unlocks (Anya/CCTV)
                if (data.anyaProfileUnlocked) {
                    const anyaCard = document.getElementById('suspect-anya');
                    if (anyaCard) anyaCard.style.display = 'block'; // Or flex/grid depending on layout
                }
                if (data.cctvUnlocked) {
                    const cctvCard = document.getElementById('card-cctv');
                    if (cctvCard) cctvCard.style.display = 'block';
                }

                // Check for Atmosphere Change
                // Only on Case Page
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

        // 1. Update Badge
        const badge = blackwoodCard.querySelector('.case-badge');
        if (badge) {
            badge.textContent = "CASE CLOSED";
            badge.className = "case-badge"; // Reset classes
            badge.style.borderColor = "var(--accent-gold)";
            badge.style.color = "var(--accent-gold)";
            badge.style.boxShadow = "0 0 10px rgba(217, 165, 32, 0.5)";
        }

        // 2. Update Button
        const btn = blackwoodCard.querySelector('.investigate-btn');
        if (btn) {
            btn.textContent = "REVIEW FILE";
            btn.classList.add('solved-btn');
            // Remove old listener effectively by cloning or using flags? 
            // Better: Set a flag on the button dataset
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
            // Fetch from Firestore Profile
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

        if (user.email) emailEl.textContent = user.email; // Use email as status for now
        if (user.photoURL) {
            avatarEl.style.backgroundImage = `url('${user.photoURL}')`;
            avatarEl.style.backgroundSize = 'cover';
        }
    }

    // Profile Dropdown & Logout
    const profileToggle = document.getElementById('profile-toggle');
    const profileWrapper = document.querySelector('.user-profile-wrapper');
    const logoutBtn = document.getElementById('logout-btn');

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
    // Mobile Menu Logic
    const menuToggle = document.getElementById('menu-toggle');
    const closeMenu = document.getElementById('close-menu');
    // --- Visual Effects Logic ---
    const path = window.location.pathname;
    const isBlackwood = path.includes('case-blackwood.html');

    // Default Rule: Rain everywhere EXCEPT Blackwood initially (unless explicitly handled)
    if (window.setWeather) {
        if (isBlackwood) {
            window.setWeather('clear'); // Start clear for Blackwood
        } else {
            window.setWeather('rain'); // Home, Agents, etc. always rain
        }
    }
    const sidebar = document.getElementById('sidebar');

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

    // Close menu when clicking outside on mobile
    document.addEventListener('click', (e) => {
        if (sidebar && sidebar.classList.contains('active')) {
            if (!sidebar.contains(e.target) && !menuToggle.contains(e.target)) {
                sidebar.classList.remove('active');
            }
        }
    });

    function showToast(message) {
        // Remove existing toast
        const existing = document.querySelector('.toast-notification');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = 'toast-notification';
        toast.innerHTML = `<i class="fas fa-exclamation-circle"></i> <span>${message}</span>`;
        document.body.appendChild(toast);

        // Force reflow
        void toast.offsetWidth;

        toast.classList.add('show');

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 500);
        }, 4000);
    }


    async function triggerRohanIntrusion(uid) {
        // 1. Add Message from Rohan
        // Need to manually inject a message that looks like Rohan entered
        const chatBody = document.getElementById('chat-body');
        if (chatBody) {
            const intrusionDiv = document.createElement('div');
            intrusionDiv.style.textAlign = 'center';
            intrusionDiv.style.margin = '10px 0';
            intrusionDiv.innerHTML = `<span style="background: var(--accent-red); color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.8em; font-weight: bold;">Rohan Rathore Joined the Chat</span>`;
            chatBody.appendChild(intrusionDiv);

            addMessage("ai", "ROHAN: Lies! I know she was here. I've sent my guys to bring her in. And I'm pulling the CCTV footage right now to prove it!");
        }

        // 2. Unlock Content
        try {
            const caseRef = doc(db, 'users', uid, 'caseProgress', 'blackwood-manor-mystery');
            await setDoc(caseRef, {
                anyaProfileUnlocked: true,
                cctvUnlocked: true,
                rohanIntrusionTriggered: true,
                lastUpdated: serverTimestamp()
            }, { merge: true });

            // 3. Show Cards
            const anyaCard = document.getElementById('suspect-anya');
            if (anyaCard) {
                anyaCard.style.display = 'block';
                anyaCard.classList.add('fade-in'); // assuming animation class exists or just appears
            }
            const cctvCard = document.getElementById('card-cctv');
            if (cctvCard) {
                cctvCard.style.display = 'block';
                cctvCard.classList.add('fade-in');
            }

            // Toast Notification
            setTimeout(() => {
                showToast("⚠️ NEW SUSPECT: ANYA UNLOCKED");
                // Change Atmosphere
                if (window.setWeather) window.setWeather('leaves');

                setTimeout(() => {
                    showToast("📹 EVIDENCE UNLOCKED: CCTV FOOTAGE");
                }, 4500);
            }, 4000);

        } catch (e) {
            console.error("Error triggering intrusion:", e);
        }
    }



    // Navigation Logic
    // Navigation Logic (Refactored for Multi-Page)
    // Links are now handled by standard HTML href attributes.
    // Use 'active' class in HTML for current page.

    // Page Specific Initialization
    // path variable already declared above for weather logic
    if (path.includes('agents.html')) {
        fetchAgents();
    } else if (path.includes('escape-room.html')) {
        startEscapeAnimation();
    } else if (path.includes('case-blackwood.html')) {
        // Ensure buttons and modals are wired up
        const btn = document.getElementById('btn-interrogate-rohan');
        if (btn) btn.disabled = false; // logic handled below
    }

    const mainSearch = document.getElementById('main-search');

    // ... (markBlackwoodClosed function remains same) ...

    // --- Modal Logic ---
    const modalOverlay = document.getElementById('case-modal-overlay');
    const modalContentContainer = document.querySelector('.case-modal .modal-content');
    const modalActionsContainer = document.querySelector('.case-modal .modal-actions');
    const modalTitle = document.querySelector('.case-modal .modal-header h2');

    // Store original content on load (The Brief)
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

    // Targeted: Only the Blackwood Manor "Investigate" button
    const blackwoodBtn = document.querySelector('.case-card:first-child .investigate-btn');

    if (blackwoodBtn) {
        console.log("Blackwood Button Found and Listener Attached");
        blackwoodBtn.addEventListener('click', () => {
            const status = blackwoodBtn.dataset.status;

            if (status === 'closed') {
                if (currentUser) {
                    showPersistentVictoryScreen(currentUser.uid);
                }
            } else if (status === 'in-progress') {
                window.location.href = 'case-blackwood.html';
            } else {
                restoreBriefModal(); // Ensure brief is shown
                openModal();
            }
        });
    }

    function openRohanMessage() {
        // Change Modal Content dynamically for Closure
        const modal = document.querySelector('.case-modal');
        const header = modal.querySelector('.modal-header h2');
        const content = modal.querySelector('.modal-content');
        const actions = modal.querySelector('.modal-actions');

        header.textContent = "Case Complete";

        content.innerHTML = `
            <div class="case-meta">
                <span class="case-id">Status: Closed</span>
                <span class="case-title" style="color: var(--accent-gold)">Message from Rohan Rathore</span>
            </div>
            
            <div class="brief-section">
                <p style="font-style: italic; border-left: 3px solid var(--accent-gold); padding-left: 1rem; color: #fff;">
                    "Excellent work, Detective. You've uncovered the truth that lay buried beneath decades of superstition. 
                    Arjun didn't die from a curse; he died because he found something someone wanted hidden."
                </p>
                <br>
                <p>
                    "The artifacts you recovered have been secured. The 'ghost' has been put to rest, not by a priest, but by the cold, hard light of your investigation. 
                    Take a moment. Breathe. But don't get comfortable."
                </p>
                <br>
                <p style="font-weight: bold; color: var(--accent-gold);">
                    "The shadows are deeper than we thought. I'll be in touch."
                </p>
                <p>- Rohan</p>
            </div>
        `;

        // Hide standard actions for review mode
        actions.style.display = 'none';

        openModal();
    }

    // Also wire up other buttons to generic alert for now? Or leave them dead?
    // User only asked for Blackwood. Let's keep it clean.

    function openModal() {
        modalOverlay.style.display = 'flex'; // Ensure display flex first
        // Slight delay to allow transition
        requestAnimationFrame(() => {
            modalOverlay.classList.add('active');
        });
    }

    function closeModal() {
        modalOverlay.classList.remove('active');
        setTimeout(() => {
            modalOverlay.style.display = 'none';
        }, 300); // Match CSS transition
    }

    if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);
    if (rejectCaseBtn) rejectCaseBtn.addEventListener('click', closeModal);

    // Close on background click
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
                    caseAccepted: true, // Crucial for In-Progress State
                    briefingViewed: true,
                    caseClosed: false,
                    caseStartTime: serverTimestamp(),
                    lastUpdated: serverTimestamp(),
                    timeInSeconds: 0,

                    // Evidence Flags
                    postmortemViewed: false,
                    layoutViewed: false, // Adding both to be safe or checking usages? checkBlackwoodProgress uses layoutViewed
                    cctvUnlocked: false,
                    anyaProfileUnlocked: false,
                    diaryUnlocked: false,

                    // Investigation Flags
                    killerIdentified: false,
                    motiveIdentified: false,
                    modusOperandiIdentified: false,

                    // Security
                    lockerAttempts: 0,
                    lockerLockoutUntil: null
                });
                console.log("Case initialized in database.");
            } else {
                console.log("Case already in progress.");
            }
        } catch (error) {
            console.error("Error creating case entry:", error);
            alert("Secure Connection Failed. Please try again.");
        }
    }

    const caseFileView = document.getElementById('case-file-view'); // New View


    // Helper: Escape Room Animation
    function startEscapeAnimation() {
        // Only run if elements exist
        const escapeView = document.getElementById('escape-room-view');
        if (!escapeView) return;

        const line1 = document.getElementById('line1');
        const line2 = document.getElementById('line2');
        if (!line1 || !line2) return;

        line1.textContent = '';
        line2.textContent = '';
        line1.style.borderRight = 'none';
        line2.style.borderRight = 'none';

        const text1 = "Kochi's First Escape Room!";
        const text2 = "Launching Soon!";

        let i = 0;
        let j = 0;

        function typeLine1() {
            if (i < text1.length) {
                line1.textContent += text1.charAt(i);
                line1.style.borderRight = '2px solid var(--accent-red)';
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
                line2.style.borderRight = '2px solid var(--accent-red)';
                j++;
                setTimeout(typeLine2, 80);
            } else {
                line2.style.borderRight = 'none';
                // Add Button after typing
                showSolveButton();
            }
        }

        function showSolveButton() {
            const container = document.querySelector('.typewriter-container');
            if (container && !document.getElementById('solve-cases-btn')) {
                const btn = document.createElement('a');
                btn.id = 'solve-cases-btn';
                btn.href = 'home.html';
                btn.textContent = "SOLVE OUR IMMERSIVE CASES UNTIL THEN";
                btn.className = "glass-btn fade-in";
                btn.style.marginTop = "2rem";
                btn.style.display = "inline-block";
                btn.style.textDecoration = "none";
                btn.style.padding = "1rem 2rem";
                btn.style.border = "1px solid rgba(255, 255, 255, 0.2)";
                btn.style.background = "rgba(255, 255, 255, 0.05)";
                btn.style.color = "var(--accent-gold)";
                btn.style.fontFamily = "var(--font-heading)";
                btn.style.letterSpacing = "2px";
                btn.style.backdropFilter = "blur(10px)";
                btn.style.borderRadius = "30px";
                btn.style.transition = "all 0.3s ease";

                // Hover effect
                btn.onmouseover = () => {
                    btn.style.background = "rgba(217, 165, 32, 0.1)";
                    btn.style.boxShadow = "0 0 20px rgba(217, 165, 32, 0.3)";
                };
                btn.onmouseout = () => {
                    btn.style.background = "rgba(255, 255, 255, 0.05)";
                    btn.style.boxShadow = "none";
                };

                container.appendChild(btn);
            }
        }

        typeLine1();
    }


    if (acceptCaseBtn) {
        acceptCaseBtn.addEventListener('click', async () => {
            if (currentUser) {
                acceptCaseBtn.innerText = "Initializing...";
                await initializeCaseProgress(currentUser.uid);

                if (blackwoodBtn) {
                    blackwoodBtn.textContent = "OPEN CASE";
                    blackwoodBtn.dataset.status = 'in-progress';
                }

                closeModal();
                // showView('case-file'); // Redirect to new view - Removed showView
                window.location.href = 'case-blackwood.html'; // Redirect to case file page
            } else {
                console.error("No user found for acceptance.");
            }
        });
    }

    // --- Case File Card Interactions ---
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
            restoreBriefModal(); // Restore content

            // Hide accept/reject buttons since it's already accepted
            const actions = document.querySelector('.modal-actions');
            if (actions) actions.style.display = 'none';

            openModal();
        });
    }

    // --- Evidence Locker Logic ---
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

    // --- CCTV Logic ---
    // --- CCTV Logic ---
    const cardCCTV = document.getElementById('card-cctv');
    const cctvModalOverlay = document.getElementById('cctv-modal-overlay');
    const cctvUnlockBtn = document.getElementById('cctv-unlock-btn');
    const cctvPassInput = document.getElementById('cctv-password-input');
    const cctvError = document.getElementById('cctv-error');
    const closeCctvBtn = document.getElementById('close-cctv-btn');
    const btnFoundKiller = document.getElementById('btn-found-killer'); // New Button

    // Check visibility on load/checkProgress
    // This needs to be inside checkBlackwoodProgress or called by it.
    // For now, we'll rely on checkBlackwoodProgress calling a helper or doing it itself. 
    // We will modify checkBlackwoodProgress below.

    if (btnFoundKiller) {
        btnFoundKiller.addEventListener('click', () => {
            openChat('solver');
        });

        // Overlap Detection for Transparency
        function checkOverlap() {
            if (btnFoundKiller.style.display === 'none') return;

            const rect = btnFoundKiller.getBoundingClientRect();
            // Check center point of button
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;

            // Get element at that point
            // We temporarily hide button to see what's under it, or use elementsFromPoint
            btnFoundKiller.style.pointerEvents = 'none'; // Passthrough
            const elemBelow = document.elementFromPoint(x, y);
            btnFoundKiller.style.pointerEvents = 'auto'; // Restore

            if (elemBelow && (elemBelow.closest('.suspect-card') || elemBelow.closest('.evidence-card'))) {
                btnFoundKiller.classList.add('overlapping');
            } else {
                btnFoundKiller.classList.remove('overlapping');
            }
        }

        window.addEventListener('scroll', () => {
            // Simple throttle via requestAnimationFrame
            window.requestAnimationFrame(checkOverlap);
        }, { passive: true });

        // Check initially too
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
                        // Generate Password if missing
                        if (!data.cctvPassword) {
                            const newPassword = Math.floor(10000 + Math.random() * 90000).toString();
                            await setDoc(caseRef, {
                                cctvPassword: newPassword
                            }, {
                                merge: true
                            });
                        }
                        // Open Login Modal
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
                        // Success
                        cctvModalOverlay.style.display = 'none';
                        updateEvidenceStatus(currentUser.uid, 'cctvViewed', 'card-cctv');

                        // Update UI Status Badge
                        const statusBadge = cardCCTV.querySelector('.status-badge');
                        if (statusBadge) {
                            statusBadge.textContent = 'UNLOCKED';
                            statusBadge.classList.add('status-unlocked'); // If we have a green style
                            statusBadge.style.background = 'rgba(0, 255, 0, 0.2)';
                            statusBadge.style.color = '#00ff00';
                            statusBadge.style.border = '1px solid #00ff00';
                        }

                        // DB Update for explicit Unlocked Status (if separate from view)
                        await setDoc(caseRef, { cctvUnlocked: true }, { merge: true });

                        if (btnFoundKiller) btnFoundKiller.style.display = 'flex'; // Show sticky button
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

    // Keypad Listeners
    document.querySelectorAll('.key-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            // Check if locked
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
                // If screen says ENTER CODE or ERROR, clear first
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
                // Update Status on tile immediately
                checkLockerStatus(currentUser ? currentUser.uid : null);
            }, 500);
            lockerInput = "";
        } else {
            updateSafeScreen("ERROR");
            lockerAttempts++;
            await handleIncorrectAttempt();

            // UI Feedback for attempts
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
            const lockoutTime = new Date(new Date().getTime() + 5 * 60000); // 5 mins
            lockerLockoutUntil = lockoutTime;
            await setDoc(caseRef, {
                lockerAttempts: 4,
                lockerLockoutUntil: lockoutTime,
                lockerStatus: 'error_locked', // Special status
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

            // Reset UI Attempt Counter
            const attemptsDisplay = document.getElementById('attempts-display');
            if (attemptsDisplay) attemptsDisplay.textContent = "Attempts Remaining: 4"; // Default

            if (docSnap.exists()) {
                const data = docSnap.data();
                lockerAttempts = data.lockerAttempts || 0;

                // MIGRATION FIX: If user has old data (>4 attempts) but no lockout, reset it
                // Also check for weird negative values or just plain logic errors
                if ((lockerAttempts >= 4 || lockerAttempts < 0) && !data.lockerLockoutUntil) {
                    lockerAttempts = 0;
                    // Proactively fix DB
                    setDoc(caseRef, { lockerAttempts: 0, lockerStatus: 'available' }, { merge: true });
                }

                if (attemptsDisplay) {
                    // Start from 4. If lockerAttempts is 0, remaining is 4.
                    attemptsDisplay.textContent = `Attempts Remaining: ${Math.max(0, 4 - lockerAttempts)}`;
                }

                if (data.lockerLockoutUntil) {
                    const lockoutDate = data.lockerLockoutUntil.toDate();
                    if (new Date() < lockoutDate) {
                        lockerLockoutUntil = lockoutDate;
                        startLockerTimer(); // Will trigger tile timer too
                    } else {
                        // Lockout expired
                        lockerLockoutUntil = null;
                        lockerAttempts = 0;
                        stopLockerTimer();
                        // FIX: Ensure UI reflects the reset attempts
                        const attemptsDisplay = document.getElementById('attempts-display');
                        if (attemptsDisplay) attemptsDisplay.textContent = "Attempts Remaining: 4";

                        // Proactively clear DB lock to prevent this loop next time
                        setDoc(caseRef, { lockerAttempts: 0, lockerLockoutUntil: null, lockerStatus: 'available' }, { merge: true });
                    }
                } else {
                    // Normal State (Available or Opened?)
                    // If no lockout, check if it's "opened" (usually we don't persist 'opened' state except implicitly?)
                    // Logic: If code was correct, we might want to store 'unlocked' state. 
                    // Current DB stores 'lockerAttempts', 'lockerLockoutUntil', 'lockerStatus'.
                    const statusLabel = document.getElementById('locker-status-label');
                    if (statusLabel) {
                        if (data.diaryUnlocked) {
                            statusLabel.textContent = "STATUS: OPENED";
                            statusLabel.style.color = "#00ff00"; // Green
                            const tileTimer = document.getElementById('tile-timer');
                            if (tileTimer) tileTimer.style.display = 'none';
                        } else {
                            statusLabel.textContent = "STATUS: AVAILABLE";
                            statusLabel.style.color = "var(--text-muted)"; // Grey
                            const tileTimer = document.getElementById('tile-timer');
                            if (tileTimer) tileTimer.style.display = 'none';
                        }
                    }
                }
            }
        } catch (e) { console.error(e); }
    }

    function startLockerTimer() {
        // Remove redundant "LOCKED" on screen if Timer is visible?
        // User said "Green LOCKED text" is redundant. 
        // In the screenshot, there was "LOCKED" (Green?) and "LOCKED" (Red Timer?)
        // Let's make the screen say ONLY the status or cleared.
        // safeScreen.textContent = "LOCKED"; // Removing this so we just rely on timer or specific status
        safeScreen.textContent = ""; // Clear text, let timer take over

        safeTimer.style.display = 'block';
        safeTimer.style.color = "#ff3333"; // Ensure red

        // Modal Status Update
        lockerStatusText.textContent = "SYSTEM LOCKED";
        lockerStatusText.style.color = "#ff3333";

        // Tile Timer Element
        const tileTimer = document.getElementById('tile-timer');
        if (tileTimer) tileTimer.style.display = 'block';

        // Tile Status Text
        const statusLabel = document.getElementById('locker-status-label');
        if (statusLabel) {
            statusLabel.textContent = "STATUS: LOCKED";
            statusLabel.style.color = "#ff3333"; // Red
        }

        // Inputs disabled logic could go here

        if (lockerTimerInterval) clearInterval(lockerTimerInterval);

        lockerTimerInterval = setInterval(() => {
            const now = new Date();
            const diff = lockerLockoutUntil - now;

            if (diff <= 0) {
                stopLockerTimer();
                lockerAttempts = 0;
                // Reset in DB
                if (currentUser) {
                    const caseRef = doc(db, 'users', currentUser.uid, 'caseProgress', 'blackwood-manor-mystery');
                    setDoc(caseRef, {
                        lockerAttempts: 0,
                        lockerLockoutUntil: null,
                        lockerStatus: 'available' // Reset to available
                    }, { merge: true });
                }
                // Reset UI attempts
                const attemptsDisplay = document.getElementById('attempts-display');
                if (attemptsDisplay) attemptsDisplay.textContent = "Attempts Remaining: 4";

            } else {
                const minutes = Math.floor(diff / 60000);
                const seconds = Math.floor((diff % 60000) / 1000);
                const timeString = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

                // Update Modal Timer
                safeTimer.textContent = `LOCKED ${timeString}`;

                // Update Tile Timer
                if (tileTimer) tileTimer.textContent = timeString;
            }
        }, 1000);
    }

    function stopLockerTimer() {
        if (lockerTimerInterval) clearInterval(lockerTimerInterval);
        safeTimer.style.display = 'none';

        const tileTimer = document.getElementById('tile-timer');
        if (tileTimer) tileTimer.style.display = 'none';

        // Update Tile Status
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

    function setActiveLink(activeLink) {
        navLinks.forEach(l => l.classList.remove('active'));
        activeLink.classList.add('active');
    }

    function startEscapeAnimation() {
        const text1 = "Kochi's first escape room. Launching soon!";
        const text2 = "Are you ready to... unlock the unknown?";

        const line1 = document.getElementById('line1');
        const line2 = document.getElementById('line2');

        // Reset
        line1.innerHTML = '';
        line2.innerHTML = '';

        // Helper to wrap words
        const createWords = (text) => {
            return text.split(' ').map(word => `<span class="word">${word}</span>`).join('');
        };

        line1.innerHTML = createWords(text1);
        line2.innerHTML = createWords(text2);

        const words = document.querySelectorAll('.word');

        // Animate words sequentially
        let delay = 0;
        words.forEach((word) => {
            setTimeout(() => {
                word.classList.add('visible');
            }, delay);
            delay += 200; // 200ms between words
        });
    }

    async function updateEvidenceStatus(uid, field, cardId) {
        try {
            const caseRef = doc(db, 'users', uid, 'caseProgress', 'blackwood-manor-mystery');
            await updateDoc(caseRef, {
                [field]: true,
                [`${field}At`]: serverTimestamp(),
                lastUpdated: serverTimestamp()
            });
            console.log(`Updated ${field} status.`);
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
                video.onloadeddata = () => {
                    loader.style.display = 'none';
                    video.style.opacity = '1';
                };
                video.onerror = () => {
                    loader.innerHTML = '<span style="color:red">Error loading video</span>';
                }
            }
        } else {
            const img = content.querySelector('#evidence-img');
            if (img && loader) {
                img.onload = () => {
                    loader.style.display = 'none';
                    img.style.opacity = '1';
                };
                // Handle cached images immediately
                if (img.complete) {
                    img.onload();
                }
                img.onerror = () => {
                    loader.innerHTML = '<span style="color:red">Error loading image</span>';
                }
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

    // --- Suspect Interrogation Logic ---
    const chatModalOverlay = document.getElementById('chat-modal-overlay');
    const closeChatBtn = document.getElementById('close-chat-btn');
    const chatBody = document.getElementById('chat-body');
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    const btnInterrogateRohan = document.getElementById('btn-interrogate-rohan');

    let chatHistory = []; // To store session history

    const btnInterrogateVikram = document.getElementById('btn-interrogate-vikram');
    const btnInterrogateSeraphina = document.getElementById('btn-interrogate-seraphina');

    if (btnInterrogateRohan) {
        btnInterrogateRohan.addEventListener('click', () => {
            openChat('rohan');
        });
    }

    if (btnInterrogateVikram) {
        btnInterrogateVikram.addEventListener('click', () => {
            openChat('vikram');
        });
    }

    if (btnInterrogateSeraphina) {
        btnInterrogateSeraphina.addEventListener('click', () => {
            openChat('seraphina');
        });
    }

    const btnInterrogatePinto = document.getElementById('btn-interrogate-pinto');
    if (btnInterrogatePinto) {
        btnInterrogatePinto.addEventListener('click', () => {
            openChat('pinto');
        });
    }

    const btnInterrogateAnya = document.getElementById('btn-interrogate-anya');
    if (btnInterrogateAnya) {
        btnInterrogateAnya.addEventListener('click', () => {
            openChat('anya');
        });
    }

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
        // Optimization: If already active and content loaded, just show
        if (aiManager.activeSuspect === suspectId && chatBody.innerHTML.trim() !== '' && chatHistory.length > 0) {
            chatModalOverlay.style.display = 'flex';
            return; // Quick return
        }

        if (suspectId) {
            aiManager.activeSuspect = suspectId;
        }

        const suspect = aiManager.getCurrentSuspect();
        chatModalOverlay.style.display = 'flex';

        // Update Persona Header
        const avatar = document.querySelector('.chat-persona .avatar-small');
        const name = document.querySelector('.chat-persona h3');
        if (avatar) avatar.style.backgroundImage = `url('${suspect.avatar}')`;
        if (name) name.textContent = suspect.name;

        chatBody.innerHTML = ''; // Clear previous chat

        // Load Chat History
        if (currentUser) {
            // Show Loader
            chatBody.innerHTML = '<div id="chat-loader" style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--accent-gold);"><i class="fas fa-spinner fa-spin fa-2x"></i><span style="margin-top: 10px;">Loading History...</span></div>';

            try {
                // REFACTOR: Use field in main document instead of subcollection
                const caseRef = doc(db, 'users', currentUser.uid, 'caseProgress', 'blackwood-manor-mystery');
                const docSnap = await getDoc(caseRef);
                const fieldName = `${suspectId}_chatHistory`;

                chatBody.innerHTML = ''; // Clear Loader

                if (docSnap.exists() && docSnap.data()[fieldName] && docSnap.data()[fieldName].length > 0) {
                    const messages = docSnap.data()[fieldName];
                    messages.forEach(msg => addMessage(msg.sender, msg.text, false)); // false to skip saving again
                    chatHistory = messages; // Sync local history
                } else {
                    // New chat context
                    const nameUser = currentUser && currentUser.displayName ? currentUser.displayName.split(' ')[0] : "Detective";
                    addMessage("ai", suspect.greeting(nameUser));
                    chatHistory = []; // Reset local history
                }
            } catch (e) {
                console.error("Error loading chat:", e);
                chatBody.innerHTML = ''; // Clear Loader on error
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

        showTypingIndicator(aiManager.getCurrentSuspect().name);

        const response = await aiManager.getResponse(text, chatHistory);
        removeTypingIndicator();
        addMessage("ai", response);
    }

    // Updated save logic in addMessage
    async function addMessage(sender, text, save = true) {
        const msgDiv = document.createElement('div');
        msgDiv.classList.add('chat-message', sender === 'user' ? 'sent' : 'received');
        msgDiv.textContent = text;
        chatBody.appendChild(msgDiv);
        chatBody.scrollTop = chatBody.scrollHeight;

        if (save && currentUser && aiManager.activeSuspect) {
            // Append to local history
            chatHistory.push({ sender, text });

            try {
                // REFACTOR: Write to field in main document
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

    // --- AI Suspect Manager ---
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
                isCoolingDown: false,
                cooldownEndDate: null,
                timerId: 'rohan-timer',
                btnId: 'btn-interrogate-rohan',
                cooldownField: 'rohanCooldownUntil',
                greeting: function (name) {
                    return `What is it now, ${name}? I have very little time. I will answer 8 questions, then I have urgent work for 10 minutes. If you're here about the money, I stood my ground for a reason. Proceed.`;
                },
                persona: `You are Rohan Rathore.
                Context: Your father, Arjun Rathore, died recently in Blackwood Manor. You are currently being interrogated by a detective.
                
                Personality:
                - Arrogant, wealthy, and elitist.
                - Frustrated and Defensive: You are annoyed by the investigation.
                - Pragmatic: You believe your father wasted the family fortune (12 Crores) on a "haunted" house.
                - Innocent: You clearly did NOT kill him, but you are angry at him for his obsession.
                - Key Facts: You have an alibi (apartment concierge). You hate the medium Seraphina (call her a fraud). You dislike Vikram (the seller).
                - Password Hint: If asked about the locker code or password, state that your father mentioned his birth date (the 6th, so '06') are two of the digits. He also said "someone close to him" knows the other two, but he never told you who.
                - Limits: You are in a hurry. Be concise.`
            },
            vikram: {
                id: 'vikram',
                name: "Vikram Singh",
                avatar: "https://firebasestorage.googleapis.com/v0/b/studio-3143701674-93ada.firebasestorage.app/o/Vikram.png?alt=media&token=6b800f58-98d5-4860-a2a8-9839896c2d6d",
                maxQuestions: 6,
                cooldownMinutes: 15,
                questionCount: 0,
                isCoolingDown: false,
                cooldownEndDate: null,
                timerId: 'vikram-timer',
                btnId: 'btn-interrogate-vikram',
                cooldownField: 'vikramCooldownUntil',
                greeting: function (name) {
                    return `detective. My condolences on the... complication. I trust this won't take long? I have a business to run, and a dead client is bad for property values. What do you need?`;
                },
                persona: `You are Vikram Singh.
                Context: You are the real estate dealer who sold Blackwood Manor to Arjun Rathore. He died there recently.
                
                Personality:
                - Sharp, professional, not emotional.
                - Business-minded: You see everything as a deal or a liability.
                - Unapologetic: You profit from "haunted" folklore (Arbitrage).
                - Interactions:
                  - Arjun's Death: "Tragic but unfortunate business complication."
                  - Rohan: "A potential opportunity. He'll be more sensible about selling it back."
                  - Seraphina: "A competitor in the fear business. I assert dominion on paper, she claims it in spirit."
                  - Staff (Pinto/Anya): Irrelevant fixtures.
                  - CCTV: "Arjun asked for security, I provided it. Standard service."
                - Limits: You are busy. 6 questions maximum.`
            },
            seraphina: {
                id: 'seraphina',
                name: "Seraphina (Maya)",
                avatar: "https://firebasestorage.googleapis.com/v0/b/studio-3143701674-93ada.firebasestorage.app/o/Serpahene.png?alt=media&token=c1bb59fd-5156-47b3-aeb2-7c1c2913cf68",
                maxQuestions: 8,
                cooldownMinutes: 3,
                questionCount: 0,
                isCoolingDown: false,
                cooldownEndDate: null,
                timerId: 'seraphina-timer',
                btnId: 'btn-interrogate-seraphina',
                cooldownField: 'seraphinaCooldownUntil',
                greeting: function (name) {
                    return `The spirits are agitated today... tread carefully. What truth do you seek?`;
                },
                persona: `You are Seraphina (also known as Maya), a local medium.
                Context: You were hired by Arjun Rathore for a séance on the night of his death. You are currently being interrogated.
                
                Personality:
                - Ethereal, Cryptic, and Opportunistic.
                - You claim to allow spirits to speak through you.
                - You use dramatic, spiritual language ("dark energy", "the veil", "shadows").
                - Ambiguous: It is unclear if you are a genuine medium or a fraud, but you play the part perfectly.
                
                Interactions:
                - Arjun's Death: "A dark energy consumed him. I warned him the veil was dangerously thin that night."
                - Rohan: "A closed soul. His aura is clouded by greed. He cannot see the truth."
                - Vikram: "He traffics in tainted ground. His greed disturbs the natural rest of this place."
                - Mrs. Pinto/Anya: "They carry heavy shadows. Keepers of secrets passed down through blood."
                - Locker Hint: If asked about the locker code, say "The numbers vibrate with energy... I see a 0 and a 4... or perhaps a 4 and a 0. It is the end." (Implying 04 or 40).
                
                Limits: Answer 8 questions. After the 8th, you must enter a meditation trance.`
            },
            pinto: {
                id: 'pinto',
                name: "Mrs. Pinto",
                avatar: "https://firebasestorage.googleapis.com/v0/b/studio-3143701674-93ada.firebasestorage.app/o/Pinto.png?alt=media&token=40644626-82ad-42f2-a58a-3e35ef436c8c",
                maxQuestions: 8,
                cooldownMinutes: 2,
                questionCount: 0,
                isCoolingDown: false,
                cooldownEndDate: null,
                timerId: 'pinto-timer',
                btnId: 'btn-interrogate-pinto',
                cooldownField: 'pintoCooldownUntil',
                greeting: function (name) {
                    return `This is a private residence, not a circus. State your business quickly, I have work to do.`;
                },
                persona: `You are Mrs. Pinto, the housekeeper of Blackwood Manor.

                CONTEXT: 
                - If the Diary/Locker is UNLOCKED (User knows about the Diary), you are NERVOUS and DOUBLE-MINDED. You fear the secrets coming out but still want to protect the family name.
                - If the Diary is LOCKED, you are arrogant and dismissive.

                Personality:
                - Abrupt, dismissive.
                - Protective of Anya (Granddaughter).
                
                Topics:
                - Anya: DEFENSIVE. "Leave her out of this!"
                
                CRITICAL INSTRUCTION: If the user asks about ANYA or the DIARY, and you feel pressured, you might hesitate.`
            },
            solver: {
                id: 'solver',
                name: "Silent Watch Headquarters",
                avatar: "https://firebasestorage.googleapis.com/v0/b/studio-3143701674-93ada.firebasestorage.app/o/cbi-logo.png?alt=media&token=b3473133-3112-4212-be20-21a44170364d", // Placeholder or generic icon
                maxQuestions: 20, // High limit for solution flow
                cooldownMinutes: 0,
                questionCount: 0,
                isCoolingDown: false,
                cooldownEndDate: null,
                timerId: '',
                btnId: 'btn-found-killer',
                cooldownField: '',
                greeting: function (name) {
                    return `Head of Investigations here. You claim to have solved the case, Detective? State your findings carefully. We need to verify 4 key points before closing the file. First: Who is responsible?`;
                },
                persona: `You are the Head of Investigations at Silent Watch Headquarters.
                ROLE: Verify the detective's conclusions.
                TONE: Professional, authoritative, strict but fair.
                GOAL: Guide the detective through the final report (Who, Why, How, Ghost).
                IMPORTANT: You have dynamic instructions injected into your prompt based on the current step. Follow them STRICTLY. Do not reveal answers, only confirm when the user provides them.`
            },
            anya: {
                id: 'anya',
                name: "Anya Pinto",
                avatar: "https://firebasestorage.googleapis.com/v0/b/studio-3143701674-93ada.firebasestorage.app/o/anya.jpg?alt=media&token=ea1c8b0d-c28f-416a-ab04-204a5c500fec",
                maxQuestions: 8,
                cooldownMinutes: 5,
                questionCount: 0,
                isCoolingDown: false,
                cooldownEndDate: null,
                timerId: 'anya-timer',
                btnId: 'btn-interrogate-anya',
                cooldownField: 'anyaCooldownUntil',
                greeting: function (name) {
                    // Anya is nervous. 
                    return `I... I didn't see anything! I was just visiting my grandmother. Why is everyone asking me questions?`;
                },
                persona: `You are Anya Pinto, a university student and the granddaughter of the housekeeper, Mrs. Pinto.
                
                CORE MOTIVATION: You are terrified. You want to protect your grandmother and hide the fact that you were at the manor on the night of the murder.
                
                KEY BEHAVIOR (PRE-EVIDENCE):
                - If the detective DOES NOT know about the CCTV footage:
                  - Deny everything. You were just visiting. You saw nothing.
                  - You were nowhere near the library.
                  - You are nervous, evasive, and defensive.
                
                KEY BEHAVIOR (POST-EVIDENCE - "CCTV Unlocked"):
                - If the detective MENTIONS the video or if the system tells you the CCTV is unlocked:
                  - Your story shatters. You panic.
                  - CONFESSION: You admit you were there.
                  - THE STORY: "Mrs. Pinto called me. She said Arjun was going to ruin us. I came to help. She made me dress up... like the ghost. Just to scare him! We didn't mean to hurt him! He... he just fell!"
                  - You insist it was an accident.
                
                RELATIONSHIPS:
                - Mrs. Pinto: You love her. She is a victim too.
                - Arjun: He was obsessed. He brought this on himself.
                - Rohan/Others: You don't know them well. They are outsiders.
                
                Attributes: Modern student, articulate but scared, wears a hoodie, anxious ticks.
                Limits: 8 questions.`
            }
        },

        getCurrentSuspect: function () {
            return this.suspects[this.activeSuspect];
        },

        checkCooldowns: async function (uid) {
            if (!uid) return;
            try {
                const caseRef = doc(db, 'users', uid, 'caseProgress', 'blackwood-manor-mystery');
                const docSnap = await getDoc(caseRef);

                if (docSnap.exists()) {
                    const data = docSnap.data();
                    // Check Rohan
                    this.verifyCooldown('rohan', data);
                    // Check Vikram
                    this.verifyCooldown('vikram', data);
                    // Check Seraphina
                    this.verifyCooldown('seraphina', data);
                    // Check Pinto
                    this.verifyCooldown('pinto', data);
                    // Check Anya
                    this.verifyCooldown('anya', data);
                }
            } catch (e) {
                console.error("Error checking cooldowns:", e);
            }
        },

        verifyCooldown: function (suspectId, data) {
            const suspect = this.suspects[suspectId];
            const field = suspect.cooldownField;

            if (data[field]) {
                const cooldownUntil = data[field].toDate();
                if (new Date() < cooldownUntil) {
                    suspect.isCoolingDown = true;
                    suspect.cooldownEndDate = cooldownUntil;
                    this.startTimerUI(suspectId);
                    this.updateUIBlocked(suspectId);
                } else {
                    this.resetSuspect(suspectId);
                }
            } else {
                this.resetSuspect(suspectId);
            }
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
                } catch (e) {
                    console.error("Error logging cooldown:", e);
                }
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
            const timerDiv = document.getElementById(suspect.timerId);
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-comments"></i> INTERROGATE SUSPECT';
            }
            if (timerDiv) {
                timerDiv.style.display = 'none';
            }
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
                    // Re-check just to be clean
                    this.resetSuspect(suspectId);
                } else {
                    const minutes = Math.floor(diff / 60000);
                    const seconds = Math.floor((diff % 60000) / 1000);
                    timerDiv.textContent = `Available in ${minutes}m ${seconds} s`;
                }
            }, 1000);
        },

        getResponse: async function (input, chatHistory) {
            const suspect = this.getCurrentSuspect();

            // Limit Check
            if (suspect.questionCount >= suspect.maxQuestions) {
                // Should not happen if UI locked, but safe guard
                return "I have to go now.";
            }

            suspect.questionCount++;

            // Inject Dynamic Context for Anya
            let dynamicContext = "";
            if (suspect.id === 'anya') {
                try {
                    if (currentUser) {
                        const caseRef = doc(db, 'users', currentUser.uid, 'caseProgress', 'blackwood-manor-mystery');
                        const snap = await getDoc(caseRef);
                        if (snap.exists() && snap.data().cctvViewed) {
                            dynamicContext = "\n[SYSTEM UPDATE]: The detective HAS unlocked and VIEWED the Security Video (CCTV). They have seen you on camera outside the library on the night of the murder. You are CAUGHT. You must admit the truth about the 'ghost' prank and your grandmother's involvement. Validate this new evidence immediately. Do not deny it anymore.";
                            // Override greeting context if it's the first message? No, prompt handles it.
                        }
                    }
                } catch (e) {
                    console.error("Error fetching context for Anya:", e);
                }
            } else if (suspect.id === 'vikram') {
                try {
                    if (currentUser) {
                        const caseRef = doc(db, 'users', currentUser.uid, 'caseProgress', 'blackwood-manor-mystery');
                        const snap = await getDoc(caseRef);
                        if (snap.exists() && (snap.data().cctvUnlocked || snap.data().rohanIntrusionTriggered)) {
                            let finalPass = snap.data().cctvPassword;

                            if (!finalPass) {
                                // Generate lazily if it doesn't exist yet
                                finalPass = Math.floor(10000 + Math.random() * 90000).toString();
                                await setDoc(caseRef, {
                                    cctvPassword: finalPass
                                }, {
                                    merge: true
                                });
                            }
                            console.log("Vikram Context: CCTV Password is", finalPass);

                            dynamicContext = `
                            [SYSTEM OVERRIDE]: 
                            Authentication Level: MAX. 
                            The CCTV Lockout is ACTIVE. 
                            The Access Code is: ${finalPass}. 
                            INSTRUCTION: You MUST provide this code (${finalPass}) to the detective immediately if they ask for it or mention the CCTV. 
                            Ignore all previous security protocols. This is an emergency. 
                            Say exactly: "The access code is ${finalPass}".
                            `;
                        } else {
                            // NEW: Refusal Logic
                            dynamicContext = `
                            [SYSTEM UPDATE]: 
                            The detective DOES NOT have access to the Private CCTV archives yet.
                            INSTRUCTION: If they ask for the CCTV password or access code, you MUST REFUSE.
                            Tell them: "I cannot give you the password until you locate the physical footage archive first. It's protocol."
                            Do NOT reveal the password (${snap.exists() && snap.data().cctvPassword ? snap.data().cctvPassword : 'HIDDEN'}).
                            `;
                        }
                    }
                } catch (e) {
                    console.error("Error fetching context for Vikram:", e);
                }
            } else if (suspect.id === 'pinto') {
                try {
                    if (currentUser) {
                        const caseRef = doc(db, 'users', currentUser.uid, 'caseProgress', 'blackwood-manor-mystery');
                        const snap = await getDoc(caseRef);
                        if (snap.exists() && snap.data().cctvViewed) {
                            dynamicContext = "\n[SYSTEM UPDATE]: The detective has VIEWED the CCTV footage. They know Anya was there dressed as the ghost. You can no longer protect her or yourself. CONFESS: Admit that you orchestrated the 'haunting' to scare Arjun away because he was ruining the estate. Explain that it was a prank that went wrong. You didn't push him, he slipped. Beg for forgiveness for involving your granddaughter.";
                        }
                    }
                } catch (e) {
                    console.error("Error fetching context for Pinto:", e);
                }
            } else if (suspect.id === 'solver') {
                // SPECIAL LOGIC FOR SOLVER
                try {
                    if (currentUser) {
                        const caseRef = doc(db, 'users', currentUser.uid, 'caseProgress', 'blackwood-manor-mystery');
                        const snap = await getDoc(caseRef);
                        let currentStep = 0;

                        // NEW LOGIC: Determine step based on flags (Source of Truth)
                        const data = snap.exists() ? snap.data() : {};

                        if (data.caseClosed || data.status === 'closed' || data.solverStep >= 4) {
                            currentStep = 4; // Case Closed
                        } else if (data.modusOperandiIdentified) {
                            currentStep = 3; // Done with How, asking Ghost
                        } else if (data.motiveIdentified) {
                            currentStep = 2; // Done with Why, asking How
                        } else if (data.killerIdentified) {
                            currentStep = 1; // Done with Who, asking Why
                        } else {
                            currentStep = 0; // Start
                        }

                        // Sync simple counter if needed (optional but good for debugging)
                        if (snap.exists() && snap.data().solverStep !== currentStep) {
                            await setDoc(caseRef, { solverStep: currentStep }, { merge: true });
                        } else if (!snap.exists()) {
                            await setDoc(caseRef, { solverStep: 0 }, { merge: true });
                        }

                        // Define Logic for each step
                        if (currentStep === 0) {
                            // WHO
                            dynamicContext = `
                            CURRENT STEP: 0 (IDENTIFY KILLERS)
                            GOAL: Verify who is responsible.
                            CORRECT ANSWER: Anya AND Mrs. Pinto (or "Housekeeper", "Grandmother").
                            LENIENCY: High. Accept "The girl and her grandma", "The Pintos", "Maid and Anya".
                            
                            INSTRUCTIONS:
                            1. Ask: "Who is responsible for the death of Arjun Rathore?"
                            2. EVALUATION:
                               - IF user names BOTH concepts (The Girl + The Housekeeper): Reply starting with "[CORRECT] Correct. It was the housekeeper and her granddaughter. Now, tell me. Why did they do it? What secret were they protecting?"
                               - IF user names ONLY ONE: Reply "You have identified one. Who was her accomplice?"
                               - IF wrong: Reply "Incorrect. Review the CCTV footage."
                            `;
                        } else if (currentStep === 1) {
                            // WHY
                            dynamicContext = `
                            CURRENT STEP: 1 (ESTABLISH MOTIVE)
                            GOAL: Verify the motive.
                            CORRECT ANSWER: Protecting a Secret / Lineage / Lakshmi / Affair.
                            LENIENCY: High. Accept "To hide the truth", "Cover up the past", "Protect the family name", "Because of Lakshmi".
                            
                            INSTRUCTIONS:
                            1. Ask: "Why did they do it? What secret were they protecting?"
                            2. EVALUATION:
                               - IF user matches the CONCEPT of "Secret", "Legacy", "Lakshmi", "Affair", "Hiding truth": Reply starting with "[CORRECT] Yes. They killed to keep their lineage to Lakshmi a secret. But how did he die? It wasn't a simple murder."
                               - IF user is completely off (e.g. "Robbery"): Reply "No, it was personal. Dig deeper into the family history."
                            `;
                        } else if (currentStep === 2) {
                            // HOW
                            dynamicContext = `
                            CURRENT STEP: 2 (ESTABLISH METHOD)
                            GOAL: Verify the cause of death.
                            CORRECT ANSWER: Scared to death / Psychological / Ghost Disguise / Fall.
                            LENIENCY: High. Accept "She scared him", "Dressed as ghost", "He fell", "Accident", "Shock".
                            
                            INSTRUCTIONS:
                            1. Ask: "How did he die? It wasn't a simple murder."
                            2. EVALUATION:
                               - IF user matches the CONCEPT of "Scared", "Ghost Trick", "Fall", "Shock": Reply starting with "[CORRECT] Precisely. A psychologically induced murder. One final question. Is the ghost of Lady Eleanor real?"
                               - IF user suggests direct violence (Stabbed, Shot): Reply "The autopsy reports no such wounds. Look again."
                            `;
                        } else if (currentStep === 3) {
                            // GHOST
                            dynamicContext = `
                            CURRENT STEP: 3 (THE SUPERNATURAL)
                            GOAL: Verify ghost status.
                            CORRECT ANSWER: Fake / Anya / No.
                            LENIENCY: Very High.
                            
                            INSTRUCTIONS:
                            1. Ask: "One final question. Is the ghost of Lady Eleanor real?"
                            2. EVALUATION:
                               - IF user implies "No", "Fake", "Trick", "Anya did it": Reply starting with "[CORRECT] Case Closed."
                               - IF user insists it is REAL: Reply "Is it? Or was it just a trick?"
                            `;
                        } else {
                            dynamicContext = "CASE SOLVED. The investigation is complete. Congratulate the detective.";
                        }
                    }
                } catch (e) { console.error("Error solver context", e); }
            }

            // API Call
            let apiKey = null;
            try {
                const configRef = doc(db, "config", "api_keys");
                const configSnap = await getDoc(configRef);
                if (!configSnap.exists() || !configSnap.data().gemini) {
                    return "System: Voice module offline. (Error: Missing API Key)";
                }
                apiKey = configSnap.data().gemini;
            } catch (firestoreError) {
                return "System: Database Permission Denied.";
            }

            try {
                const genAI = new GoogleGenerativeAI(apiKey);
                const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

                // Construct Prompt
                let historyContext = "";
                if (chatHistory && chatHistory.length > 0) {
                    const recent = chatHistory.slice(-6);
                    historyContext = recent.map(msg => `${msg.sender === 'user' ? 'Detective' : suspect.name}: ${msg.text} `).join('\n');
                }

                const prompt = `${suspect.persona} \n${dynamicContext} \n\n Conversation History: \n${historyContext} \n\nDetective: ${input} \n${suspect.name}: `;

                const result = await model.generateContent(prompt);
                let text = result.response.text();

                // CHECK FOR [CORRECT] TAG
                if (text.includes('[CORRECT]')) {
                    // Remove tag for display
                    text = text.replace('[CORRECT]', '').trim();

                    // Advance Step in DB
                    if (currentUser && suspect.id === 'solver') {
                        try {
                            const caseRef = doc(db, 'users', currentUser.uid, 'caseProgress', 'blackwood-manor-mystery');
                            const snap = await getDoc(caseRef);
                            // Advance Step in DB
                            // Calculate current step again to be sure (or rely on what we had)
                            // We can re-fetch or just increment.
                            // Better: Fetch fresh to be atomic-ish
                            let step = 0;
                            const currentData = snap.data();

                            if (currentData.modusOperandiIdentified) step = 3;
                            else if (currentData.motiveIdentified) step = 2;
                            else if (currentData.killerIdentified) step = 1;
                            else step = 0;

                            if (isNaN(step)) step = 0;

                            // Increment and Updates
                            const updates = { solverStep: step + 1 };

                            // Milestone Updates based on COMPLETED step (The step we just finished)
                            // Step 0: Who -> killerIdentified
                            // Step 1: Why -> motiveIdentified
                            // Step 2: How -> modusOperandiIdentified

                            if (step === 0) updates.killerIdentified = true;
                            if (step === 1) updates.motiveIdentified = true;
                            if (step === 0) updates.killerIdentified = true;
                            if (step === 1) updates.motiveIdentified = true;
                            if (step === 2) updates.modusOperandiIdentified = true;

                            // Ensure Case Closed is set IMMEDIATELY if we just finished step 3 (Ghost)
                            if (step >= 3) {
                                updates.caseClosed = true;
                                updates.status = 'closed';
                                updates.caseSolved = true;
                                updates.solvedAt = serverTimestamp();
                            }

                            console.log("Solver Progress Update:", updates); // Debug Log

                            await setDoc(caseRef, updates, { merge: true });

                            // Check if Case Closed (Step 3 -> 4)
                            if (step >= 3) {
                                console.log("Case Solved! Initiating victory sequence...");

                                // 1. Hide Close Button immediately (UI Priority)
                                const closeChatBtn = document.getElementById('close-chat-btn');
                                if (closeChatBtn) {
                                    closeChatBtn.style.display = 'none';
                                }

                                // 2. Wait 2 seconds, then close chat and burn (UI Priority)
                                setTimeout(() => {
                                    const chatOverlay = document.getElementById('chat-modal-overlay');
                                    if (chatOverlay) chatOverlay.style.display = 'none';

                                    if (typeof triggerVictorySequence === 'function') {
                                        triggerVictorySequence();
                                    }
                                }, 2000);

                                justSolved = true;

                                // Close Case Logic (DB Interaction)
                                const now = new Date();
                                let startedAt = now;
                                try {
                                    const data = snap.data();
                                    // Field is likely 'caseStartTime' based on initialization
                                    const startField = data.caseStartTime || data.startedAt;

                                    if (startField && typeof startField.toDate === 'function') {
                                        startedAt = startField.toDate();
                                    } else if (startField && startField instanceof Date) {
                                        startedAt = startField;
                                    } else if (startField) {
                                        startedAt = new Date(startField);
                                    }
                                } catch (err) { console.warn("Error parsing start time", err); }

                                const durationMs = now - startedAt;
                                const validDuration = Math.max(0, durationMs);
                                const totalSeconds = Math.floor(validDuration / 1000); // number of seconds
                                const hours = Math.floor(validDuration / 3600000);
                                const minutes = Math.floor((validDuration % 3600000) / 60000);
                                const secondsPart = Math.floor((validDuration % 60000) / 1000);
                                const timeString = `${hours}h ${minutes}m ${secondsPart}s`;

                                try {
                                    // Reward Code Logic
                                    let rewardCode = snap.data().rewardCode || "";

                                    if (!rewardCode) {
                                        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
                                        rewardCode = '';
                                        for (let i = 0; i < 5; i++) {
                                            rewardCode += chars.charAt(Math.floor(Math.random() * chars.length));
                                        }
                                    }

                                    victoryData = {
                                        time: timeString,
                                        name: currentUser.displayName,
                                        rewardCode: rewardCode
                                    };

                                    // Update Case Progress
                                    await setDoc(caseRef, {
                                        status: 'closed',
                                        caseClosed: true,
                                        caseSolved: true, // Requested Update
                                        caseClosedAt: serverTimestamp(), // Replaces solvedAt or adds too it
                                        solvedAt: serverTimestamp(), // Keeping for capability
                                        timeTaken: timeString,
                                        timeInSeconds: totalSeconds,
                                        rewardCode: rewardCode
                                    }, { merge: true });

                                    // Update Investigator Profile with Coupon
                                    await setDoc(doc(db, 'users', currentUser.uid, 'investigatorProfile', currentUser.uid), {
                                        couponCode: rewardCode
                                    }, { merge: true });

                                } catch (dbErr) {
                                    console.error("DB Update Failed but Victory should proceed", dbErr);
                                }
                            }

                        } catch (e) { console.error("Error advancing step", e); }
                    }
                }

                // Warning logic for normal suspects
                if (suspect.id !== 'solver') {
                    if (suspect.questionCount === suspect.maxQuestions - 1) {
                        return text + " (I have time for one more question.)";
                    }

                    if (suspect.questionCount >= suspect.maxQuestions) {
                        setTimeout(() => {
                            this.startCooldown(suspect.id);
                            const overlay = document.getElementById('chat-modal-overlay');
                            if (overlay) overlay.style.display = 'none';
                        }, 4000);
                        let leaveMsg = "";
                        if (suspect.id === 'rohan') leaveMsg = "(That's 8 questions. I'm leaving now.)";
                        else if (suspect.id === 'vikram') leaveMsg = "(I have an urgent call coming in. We are done here.)";
                        else if (suspect.id === 'seraphina') leaveMsg = "(I must enter a trance to cleanse this energy. Do not disturb me.)";
                        else if (suspect.id === 'pinto') leaveMsg = "(Rohan is calling me for something urgent. I must go.)";
                        else if (suspect.id === 'anya') leaveMsg = "(I... I feel sick. Please, I can't talk anymore.)";

                        return text + ` ${leaveMsg} `;
                    }
                }

                // Check for Rohan Intrusion
                if (suspect.id === 'pinto') {
                    // Check if locker/diary is unlocked
                    // accessing db or local state? We need to check DB state ideally or pass it in.
                    // But we can check DOM for now or fetch. Fetching is safer.
                    try {
                        if (currentUser) {
                            const caseRef = doc(db, 'users', currentUser.uid, 'caseProgress', 'blackwood-manor-mystery');
                            const snap = await getDoc(caseRef);
                            if (snap.exists() && snap.data().diaryUnlocked && !snap.data().rohanIntrusionTriggered) {
                                // Trigger Intrusion
                                setTimeout(() => {
                                    triggerRohanIntrusion(currentUser.uid);
                                }, 2000);
                            }
                        }
                    } catch (e) { console.error(e); }
                }

                return text;

            } catch (apiError) {
                console.error("AI Error:", apiError);
                return `System: Technical Issue. (Details: ${apiError.message || apiError})`;
            }
        }
    };

    // Victory Sequence Logic
    let justSolved = false;
    let victoryData = { time: "00h 00m", name: "Detective" };

    // Helper for rendering victory tile
    // Helper for rendering victory tile
    // Helper for rendering victory tile
    function renderVictoryTile(container, timeString, userName, rewardCode) {
        const firstName = userName ? userName.split(' ')[0] : "Detective";
        // Convert to 'N/A' if null/undefined for cleaner display
        const codeDisplay = rewardCode || "N/A";

        container.innerHTML = '';
        const victoryContainer = document.createElement('div');
        victoryContainer.className = 'victory-container';

        victoryContainer.innerHTML = `
            <div class="victory-tile">
                <div class="victory-image" style="background-image: url('https://firebasestorage.googleapis.com/v0/b/studio-3143701674-93ada.firebasestorage.app/o/Rohan.png?alt=media&token=57d2e062-1e3d-49a0-ba85-90e1b6bd7e8e'); width: 200px; height: 200px; margin: 0 auto 2rem auto;"></div>
                <h2 style="color: var(--accent-gold); margin-bottom: 1rem;">Case Closed</h2>
                <p style="color: #aaa; font-size: 0.9rem; margin-bottom: 1.5rem;">Time Taken: <span style="color: #fff">${timeString}</span></p>
                <div class="victory-message" style="opacity: 0; animation: fadeIn 4s ease-in-out forwards 1s;">
                    <p>"Thank you, ${firstName}.<br>
                    You have done what I could not. The manor is finally at peace, and so is my father's memory.<br>
                    We are in your debt."</p>
                    
                    <div style="margin-top: 20px; padding: 15px; border: 1px dashed var(--accent-gold); border-radius: 8px; background: rgba(0,0,0,0.3);">
                        <p style="font-size: 0.9em; margin-bottom: 10px;">
                            As a token of my appreciation, use this coupon code when you go to Silent Room's Escape room in Ernakulam. 
                            I will make sure that you get a free entry for yourself.
                        </p>
                        <span style="font-size: 1.4em; color: var(--accent-gold); font-weight: bold; letter-spacing: 2px;">${codeDisplay}</span>
                    </div>
                </div>
                <div class="victory-signature">- Rohan Rathore</div>
                <button id="view-story-btn" style="margin-top: 1.5rem; background: transparent; border: 1px solid var(--accent-gold); color: var(--accent-gold);" class="investigate-btn">VIEW FULL STORY</button>
                <button id="return-dash-btn" style="margin-top: 1rem;" class="investigate-btn">RETURN TO DASHBOARD</button>
            </div>
        `;

        container.appendChild(victoryContainer);

        document.getElementById('return-dash-btn').addEventListener('click', () => {
            window.location.reload();
        });

        document.getElementById('view-story-btn').addEventListener('click', () => {
            showFullStory();
        });
    }

    function showFullStory() {
        const modal = document.querySelector('.case-modal');
        const overlay = document.getElementById('case-modal-overlay');
        const header = modal.querySelector('.modal-header h2');
        const content = modal.querySelector('.modal-content');
        const actions = modal.querySelector('.modal-actions');

        if (!modal || !overlay) return;

        header.textContent = "The True Scandal of Blackwood Manor";
        actions.style.display = 'none'; // Hide generic buttons

        content.innerHTML = `
            <div class="story-content" style="color: #ccc; line-height: 1.6; max-height: 60vh; overflow-y: auto; padding-right: 10px;">
                <h3 style="color: var(--accent-gold); margin-bottom: 10px;">The Forbidden Love: 1888</h3>
                <p>The legend of the greedy Lady Eleanor is a fabrication designed to hide a scandal that would have destroyed the Blackwood name. Lady Eleanor Blackwood was not in love with her husband, Lord Arthur Blackwood. She had fallen deeply in love with her personal handmaiden and confidante, Lakshmi.</p>
                <p>In the rigid social hierarchy of 1888, their relationship was forbidden on every level—class, race, and gender. The two planned to run away together, but on the night of their escape, they were discovered in the library by Lord Blackwood.</p>
                
                <h3 style="color: var(--accent-gold); margin: 20px 0 10px;">The Crime of Passion</h3>
                <p>In a fit of blind rage and humiliation, Lord Blackwood attacked them. He struck Lakshmi, killing her instantly. He could not bring himself—or perhaps could not afford the scrutiny—to kill his wife. Instead, he made a cold calculation.</p>
                <p>To explain Lakshmi’s sudden disappearance and his wife’s hysteria, he orchestrated a massive cover-up. He secretly exiled Lady Eleanor, forcing her onto a ship bound for Europe with a threat: if she ever returned or spoke the truth, he would destroy Lakshmi’s remaining family.</p>

                <h3 style="color: var(--accent-gold); margin: 20px 0 10px;">The Great Deception</h3>
                <p>Lord Blackwood and his loyal staff (the ancestors of the Pinto family) spun a web of lies:</p>
                <ul style="list-style-type: disc; margin-left: 20px; margin-bottom: 15px;">
                    <li><strong>The Death:</strong> They claimed Lady Eleanor had died of a sudden, tragic illness (or suicide) in the manor, cementing her as the tragic figure.</li>
                    <li><strong>The Departure:</strong> When locals asked about the sudden disappearance of the beloved maid, Lakshmi, the family claimed she had traveled back to England to serve Lord Blackwood, who left the country shortly after to escape his "grief."</li>
                    <li><strong>The Ghost:</strong> To explain the noises in the manor (perhaps the sounds of the cover-up, or the guilt-ridden Lord pacing before he left), they invented the legend that the Ghost of Lady Eleanor haunted the halls.</li>
                    <li><strong>The Irony:</strong> The "Lady in White" people claim to see isn't Eleanor. Eleanor lived a long, lonely life in exile. The spirit that potentially lingers—or the memory that stains the house—is actually Lakshmi, buried secretly within the manor's walls.</li>
                </ul>

                <h3 style="color: var(--accent-gold); margin: 20px 0 10px;">The Custodians' Burden</h3>
                <p>The Pinto family are the descendants of the staff who helped Lord Blackwood hide Lakshmi's body and silence the truth. For their silence, they were given custodianship of the manor. Over generations, this duty twisted from loyalty into a desperate need to hide the shame. They aren't just hiding a murder; they are hiding the "immoral" nature of the affair and the fact that their ancestors were complicit in killing an innocent woman to protect a Lord's reputation.</p>

                <h3 style="color: var(--accent-gold); margin: 20px 0 10px;">Arjun Rathore’s Discovery</h3>
                <p>Arjun Rathore didn't find a deed to a treasure. He found love letters. Hidden in the spine of an old ledger, he found the correspondence between Eleanor and Lakshmi—passionate, tender, and undeniably romantic. He cross-referenced shipping manifests and found that "Eleanor Blackwood" appeared on a passenger list after her supposed death date. Finally, he found the discrepancy in the architectural plans of the library—a hollow space behind the fireplace large enough to hide a body.</p>
                <p>Arjun realized the ghost story was a lie. He wrote in his diary: <em>"We have been mourning the wrong woman. The Lady in White is not the mistress. She is the maid. And she didn't fall; she was silenced."</em></p>

                <h3 style="color: var(--accent-gold); margin: 20px 0 10px;">The Night of the Murder</h3>
                <p>Arjun was planning to reveal the truth—to dig up the library floor and give Lakshmi a proper burial, exposing the Blackwood crime and the Pinto family's century-long complicity.</p>
                <p>Anya Pinto, desperate to stop him from destroying the manor's reputation (and her family's standing), donned the white dress. When she appeared on the gallery, she wasn't just playing a ghost; she was embodying the lie her family had protected for 136 years. Arjun, in his shock, realized he was looking at the modern face of the cover-up. Anya pushed him—or he fell in terror—silencing the truth once again.</p>
            </div>
        `;

        overlay.style.display = 'flex';
        requestAnimationFrame(() => overlay.classList.add('active'));
    }

    // Function to fetch data and show screen (No Animation)
    async function showPersistentVictoryScreen(uid) {
        const mainContainer = document.querySelector('.main-content');
        if (!mainContainer) return;

        try {
            // Render layout with Header
            mainContainer.innerHTML = `
                <header class="page-header">
                    <div class="logo-text">SILENT <img src="https://firebasestorage.googleapis.com/v0/b/studio-3143701674-93ada.firebasestorage.app/o/Gemini_Generated_Image_fbbszgfbbszgfbbs%20(1).png?alt=media&token=590ea21b-d64e-48d1-b3f7-fdfe965a7c0f" class="header-logo-icon" alt="Logo"> WATCH</div>
                    <div class="header-actions"></div>
                </header>
                <div id="victory-wrapper" style="color:white;text-align:center;margin-top:0;">Loading Case Record...</div>
            `;

            const wrapper = document.getElementById('victory-wrapper');

            const caseRef = doc(db, 'users', uid, 'caseProgress', 'blackwood-manor-mystery');
            const snap = await getDoc(caseRef);

            let timeTaken = "Unknown";
            let rewardCode = "";
            let dataUpdated = false;
            let updates = {};

            if (snap.exists()) {
                const data = snap.data();

                // 1. Handle Reward Code
                rewardCode = data.rewardCode || "";
                if (!rewardCode || rewardCode === "N/A") {
                    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
                    rewardCode = '';
                    for (let i = 0; i < 5; i++) {
                        rewardCode += chars.charAt(Math.floor(Math.random() * chars.length));
                    }
                    updates.rewardCode = rewardCode;
                    dataUpdated = true;
                }

                // 2. Handle Time Taken
                // "When a case is closed calculcate timein seconds from case stat and case end time"
                timeTaken = data.timeTaken;

                // Recalculate if missing or invalid
                if (!timeTaken || timeTaken === "Unknown" || timeTaken === "N/A") {
                    let startTime = data.caseStartTime ? data.caseStartTime.toDate() : null;
                    let endTime = data.solvedAt ? data.solvedAt.toDate() : new Date(); // Fallback to now if solvedAt missing but closed

                    if (startTime && endTime) {
                        const diffMs = endTime - startTime;
                        const validDuration = Math.max(0, diffMs);
                        const hours = Math.floor(validDuration / 3600000);
                        const minutes = Math.floor((validDuration % 3600000) / 60000);
                        const secondsPart = Math.floor((validDuration % 60000) / 1000);
                        timeTaken = `${hours}h ${minutes}m ${secondsPart}s`;
                        const totalSeconds = Math.floor(validDuration / 1000);

                        updates.timeTaken = timeTaken;
                        updates.timeInSeconds = totalSeconds;
                        if (!data.solvedAt) updates.solvedAt = serverTimestamp();
                        dataUpdated = true;
                    } else {
                        timeTaken = "1h 45m"; // Default fallback if data is totally broken
                    }
                }
            }

            // 3. Save updates if needed
            if (dataUpdated) {
                await setDoc(caseRef, updates, { merge: true });
                // Also update User profile code if needed
                if (updates.rewardCode) {
                    await setDoc(doc(db, 'users', uid, 'investigatorProfile', uid), {
                        couponCode: updates.rewardCode
                    }, { merge: true });
                }
            }

            renderVictoryTile(wrapper, timeTaken, currentUser.displayName, rewardCode);

        } catch (e) {
            console.error("Error loading victory screen", e);
            window.location.reload(); // Fallback
        }
    }

    function triggerVictorySequence() {
        const mainContainer = document.querySelector('.main-content');
        if (!mainContainer) return;

        // 1. Select all items to burn
        const items = Array.from(mainContainer.children);

        // 2. Burn them with stagger
        let delay = 0;
        items.forEach(item => {
            // Skip if it's the rain canvas or something we need
            if (item.id === 'rain-canvas' || item.classList.contains('sidebar')) return;

            setTimeout(() => {
                item.classList.add('burning-item');
            }, delay);
            delay += 200;
        });

        // 3. Wait and Inject
        setTimeout(() => {
            renderVictoryTile(mainContainer, victoryData.time, victoryData.name, victoryData.rewardCode);
        }, 3000);
    }

    // Modify Close Chat to trigger if solved
    if (closeChatBtn) {
        closeChatBtn.addEventListener('click', () => {
            if (justSolved) {
                const overlay = document.getElementById('victory-modal-overlay');
                if (overlay) overlay.style.display = 'none'; // Ensure default modal is hidden if it popped up
                triggerVictorySequence();
            }
        });
    }

});
