import { db } from './auth.js';
import { collectionGroup, getDocs, collection, doc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let allAgents = []; // Stored state for filtering and sorting

export async function fetchAgents() {
    console.log("Fetching agents...");
    const tableBody = document.getElementById('agents-table-body');
    const searchInput = document.getElementById('agent-search');

    if (!tableBody) return;

    tableBody.innerHTML = '<tr><td colspan="4" class="loading-text" style="text-align:center; padding: 2rem; color: #aaa;">Accessing Classified Database...</td></tr>';

    try {
        const querySnapshot = await getDocs(collectionGroup(db, 'investigatorProfile'));

        if (querySnapshot.empty) {
            tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 2rem; color: #aaa;">No active agents found in the network.</td></tr>';
            return;
        }

        const agentsData = await Promise.all(querySnapshot.docs.map(async (profileDoc) => {
            const data = profileDoc.data();
            const name = data.name || "Unknown Agent";
            let uid = null;
            if (profileDoc.ref.parent && profileDoc.ref.parent.parent) {
                uid = profileDoc.ref.parent.parent.id;
            }

            let solvedCount = 0;
            let totalSeconds = 0;
            let avgTimeDisplay = "0h 0m";
            let totalMinutesForSort = 999999;

            if (uid) {
                try {
                    const progressRef = collection(db, 'users', uid, 'caseProgress');
                    const progressSnap = await getDocs(progressRef);

                    progressSnap.forEach(caseDoc => {
                        const caseData = caseDoc.data();
                        if (caseData.caseClosed === true) {
                            solvedCount++;
                            if (caseData.timeInSeconds && caseData.timeInSeconds > 0) {
                                totalSeconds += caseData.timeInSeconds;
                            } else {
                                const possibleStrings = [caseData.timeToClose, caseData.timeTaken, caseData.timetolose];
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
                                            totalSeconds += currentSeconds;
                                            break;
                                        }
                                    }
                                }
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
                } catch (err) { }
            }

            return { name, solvedCount, avgTimeDisplay, totalMinutesForSort };
        }));

        allAgents = agentsData;

        // Attach Event Listeners
        if (searchInput) {
            searchInput.addEventListener('input', () => renderAgents());
        }

        renderAgents();

    } catch (error) {
        console.error("Error fetching agents:", error);
        tableBody.innerHTML = `<tr><td colspan="4" class="error-text" style="text-align:center; padding:2rem; color: #ff6b6b;">Connection Refused: Secure Channel Required. (${error.message})</td></tr>`;
    }
}

function renderAgents() {
    const tableBody = document.getElementById('agents-table-body');
    const searchInput = document.getElementById('agent-search');
    const sortSelect = document.getElementById('sort-filter');

    if (!tableBody) return;

    // Filter
    let filtered = [...allAgents];
    if (searchInput) {
        const query = searchInput.value.toLowerCase().trim();
        if (query) {
            filtered = filtered.filter(a => a.name.toLowerCase().includes(query));
        }
    }

    // Sort: Default to Time increasing
    filtered.sort((a, b) => a.totalMinutesForSort - b.totalMinutesForSort);

    // Render
    tableBody.innerHTML = '';

    if (filtered.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 2rem; color: #888;">No agents found.</td></tr>';
        return;
    }

    filtered.forEach(agent => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="font-weight:600; color:#eee;">${agent.name}</span>
                </div>
            </td>
            <td>${agent.solvedCount}</td>
            <td>${agent.avgTimeDisplay}</td>
        `;
        tableBody.appendChild(tr);
    });
}
