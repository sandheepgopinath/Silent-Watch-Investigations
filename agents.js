import { db } from './auth.js';
import { collectionGroup, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

        querySnapshot.forEach((doc) => {
            const data = doc.data();
            const name = data.name || "Unknown Agent";
            // Random solved cases count for now since it's not in schema
            const solvedCount = Math.floor(Math.random() * 50) + 1;

            const agentCard = document.createElement('div');
            agentCard.className = 'agent-card';
            agentCard.innerHTML = `
                <div class="agent-avatar"><i class="fas fa-user-secret"></i></div>
                <div class="agent-details">
                    <h3>${name}</h3>
                    <p class="agent-status">Level ${Math.floor(solvedCount / 10) + 1} Cleared</p>
                    <div class="agent-stats">
                        <span class="stat"><i class="fas fa-check-circle"></i> ${solvedCount} Solved</span>
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
