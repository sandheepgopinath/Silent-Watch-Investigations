import { db } from './auth.js';
import { collectionGroup, getDocs, collection, doc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

export async function fetchAgents() {
    console.log("Fetching agents...");
    const agentsList = document.getElementById('agents-list');
    agentsList.innerHTML = '<p class="loading-text">Accessing Classified Database...</p>';

    try {
        const querySnapshot = await getDocs(collectionGroup(db, 'investigatorProfile'));

        if (querySnapshot.empty) {
            agentsList.innerHTML = '<p>No active agents found in the network.</p>';
            return;
        }

        agentsList.innerHTML = ''; // Clear loading text

        const agentsData = await Promise.all(querySnapshot.docs.map(async (profileDoc) => {
            const data = profileDoc.data();
            const name = data.name || "Unknown Agent";

            // Derive UID from path (assuming users/{uid}/investigatorProfile/{docId})
            // If profile is top level, this won't work, but typically profiles are user-centric.
            // Alternative: check if auth.uid is available or if data contains uid.
            // Let's assume parent.parent is the user doc.
            let uid = null;
            if (profileDoc.ref.parent && profileDoc.ref.parent.parent) {
                uid = profileDoc.ref.parent.parent.id;
            }

            let solvedCount = 0;
            let totalSeconds = 0;
            let avgTimeDisplay = "";
            let totalMinutesForSort = 999999; // Default for 0 cases (bottom of list)

            if (uid) {
                try {
                    const progressRef = collection(db, 'users', uid, 'caseProgress');
                    const progressSnap = await getDocs(progressRef);

                    progressSnap.forEach(caseDoc => {
                        const caseData = caseDoc.data();
                        if (caseData.caseClosed === true) {
                            solvedCount++;

                            // 1. timeInSeconds (Priority)
                            if (caseData.timeInSeconds && caseData.timeInSeconds > 0) {
                                totalSeconds += caseData.timeInSeconds;
                            } else {
                                // 2. Parse Strings (timeToClose > timeTaken > timetolose)
                                const possibleStrings = [
                                    caseData.timeToClose,
                                    caseData.timeTaken,
                                    caseData.timetolose
                                ];

                                let parsedSeconds = 0;

                                for (const timeStr of possibleStrings) {
                                    if (timeStr && typeof timeStr === 'string') {
                                        let hours = 0;
                                        let minutes = 0;

                                        const hMatch = timeStr.match(/(\d+)h/);
                                        const mMatch = timeStr.match(/(\d+)m/);

                                        if (hMatch) hours = parseInt(hMatch[1]);
                                        if (mMatch) minutes = parseInt(mMatch[1]);

                                        const currentSeconds = (hours * 3600) + (minutes * 60);
                                        if (currentSeconds > 0) {
                                            parsedSeconds = currentSeconds;
                                            break; // Found a valid non-zero time
                                        }
                                    }
                                }

                                totalSeconds += parsedSeconds;
                            }
                        }
                    });

                    if (solvedCount > 0) {
                        const avgSeconds = totalSeconds / solvedCount;
                        const hours = Math.floor(avgSeconds / 3600);
                        const minutes = Math.floor((avgSeconds % 3600) / 60);
                        avgTimeDisplay = `${hours}h ${minutes}m`;
                        totalMinutesForSort = (hours * 60) + minutes;
                    }
                } catch (err) {
                    // Fail silently or log
                }
            }

            return { name, solvedCount, avgTimeDisplay, totalMinutesForSort };
        }));

        // Sort: High solved count first, then fastest time
        agentsData.sort((a, b) => {
            if (b.solvedCount !== a.solvedCount) {
                return b.solvedCount - a.solvedCount; // Most cases first
            }
            return a.totalMinutesForSort - b.totalMinutesForSort; // Fastest time second
        });

        agentsData.forEach(agent => {
            const agentCard = document.createElement('div');
            agentCard.className = 'agent-card';

            let statsHTML = `<span class="stat"><i class="fas fa-check-circle"></i> Cases Solved: <strong>${agent.solvedCount}</strong></span>`;

            if (agent.solvedCount > 0) {
                statsHTML += `<span class="stat" style="margin-top: 5px; display: block; font-size: 0.9em; color: #888;"><i class="fas fa-clock"></i> Avg Time: <strong>${agent.avgTimeDisplay}</strong></span>`;
            }

            agentCard.innerHTML = `
                <div class="agent-avatar"><i class="fas fa-user-secret"></i></div>
                <div class="agent-details">
                    <h3>${agent.name}</h3>
                    <div class="agent-stats">
                        ${statsHTML}
                    </div>
                </div>
            `;
            agentsList.appendChild(agentCard);
        });

    } catch (error) {
        console.error("Error fetching agents:", error);
        agentsList.innerHTML = `<p class="error-text">Connection Refused: Secure Channel Required. (${error.message})</p>`;
    }
}
