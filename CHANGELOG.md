# Development Changelog

## 2025-12-12
### Case Investigation & Postmortem Viewer Implementation

-   **[dashboard.js]**: Consolidated `acceptCaseBtn` event listeners to prevent duplicate logic.
-   **[dashboard.js]**: Updated 'Investigate Case' flow for Blackwood Manor. Accepting the case now immediately redirects to the 'Case File' view.
-   **[dashboard.js]**: Changed button text from "CONTINUE INVESTIGATION" to "OPEN CASE" upon acceptance.
-   **[dashboard.js]**: Implemented `showEvidence` function and added a click listener to the 'Postmortem Report' card.
-   **[dashboard.js]**: Wired 'Postmortem Report' to open a modal with the evidence image: `PostMortem Report.png`.
-   **[dashboard.js]**: Remov   ed the "Encryption Keys Loaded" alert message upon case acceptance for a smoother UX.
-   **[dashboard.js]**: Added a loading spinner to the evidence modal. The spinner is displayed while the image is being fetched and is replaced by the image once loaded.
-   **[dashboard.js]**: Wired 'Manor Layout' to open a modal with the layout image: `layout.jpg`.
-   **[dashboard.js]**: Implemented logic to interactively update the database when 'Postmortem Report' or 'Manor Layout' is viewed.
-   **[dashboard.js]**: Added specific timestamps (`layoutViewedAt`, `postmortemViewedAt`) to track exact viewing times.
-   **[dashboard.js]**: Added UI synchronization logic. Evidence cards now display a green checkmark and "Status: Viewed" immediately upon viewing and persist this state across sessions.
-   **[home.html]**: Standardization of evidence card text. All pending items start as "Status: Unopened".
-   **[home.html/dashboard.js]**: Applied Golden text styling to "Status: Viewed" across all evidence cards, including the Investigation Brief.
-   **[home.html/style.css]**: Added "Suspects" section with Rohan Rathore's profile card.
-   **[dashboard.js]**: Implemented "Simulated AI" chat interface. Users can now interrogate Rohan Rathore, who responds based on predefined personality traits and topics (Money, Will, Father, etc.).
-   **[dashboard.js]**: Enhanced AI logic:
    -   **Cooldown System**: After 10 questions, interrogation is disabled for 10 minutes.
    -   **Contextual Greeting**: Uses the player's name.
    -   **Progressive Hints**: Provides clues for the Evidence Locker code (Date + 2 nums -> 06...).
    -   **Instant Responses**: Removed artificial typing delay for snappier interaction.
-   **[style.css]**: Refined Suspect Card UI to be more compact (300px width) with a full-height image.
-   **[dashboard.js]**: **Major Upgrade**: Replaced Simulated AI with **Google Gemini API** (`gemini-2.5-flash`).
    -   **Real Intelligence**: Conversation is now powered by a Large Language Model with a dedicated persona prompt.
    -   **Context Awareness**: The AI remembers conversation history for realistic follow-ups.
    -   **Persistence**: Chat history is automatically saved to Firebase (`caseProgress.chatHistory`), allowing session resumption.
    -   **Configuration**: API Key is securely fetched from Firestore (`config/api_keys`) rather than being hardcoded.
    -   **Error Handling**: Robust error messages exposed to UI for easier debugging of quota/API issues.

**Frontend Summary:**
The UI now supports a smoother investigation flow with standard evidence tracking. A new "Suspect Interrogation" feature allows users to interact with Rohan Rathore via a chat interface. The AI, now powered by Google's Gemini v2.5, responds dynamically in-character, maintaining conversation context and providing a truly immersive interrogation experience. The system includes persistent history and secure configuration via Firestore.
