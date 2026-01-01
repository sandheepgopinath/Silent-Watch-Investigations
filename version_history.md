# Version History

## v2.5
- **Voiceless Caller**: 
    - Implemented new premium SOS Alert UI with live timer and status tracking.
    - Added integrated fields for Location Tracking (with 1s delay) and Unit Assignment.
    - **Unit AI**: Integrated Gemini 2.0-flash-lite for ground unit Beta-1 with a professional, tactical persona.
    - **Chat Integration**: Added "Chat Status" and "Chat with Unit" button directly on SOS Alert cards.
    - Added Typing indicator animation for AI ground units.
    - Fixed API connectivity issues by implementing dynamic key fetching from Firestore.

## v2.4
- **UI**:
    - Correction of logo position in the sidebar.
    - Replaced sidebar "SILENT WATCH" text with the official icon logo across all dashboard pages.

## v2.3
- **Sidebar**:
    - Fixed specific layout issue on mobile where user name and logout option were floating.
    - Forced user profile section to anchor to the bottom of the sidebar.

## v2.2
- **Agents Page**:
    - **Dynamic Stats**: Implemented logic to calculate individual player statistics.
        - `Cases Solved`: Count of cases where `caseClosed` is true.
        - `Average Time`: Parsed from `timeToClose` (Legacy) or `timeTaken` (New) fields.
        - Logic to hide average time if no cases are solved.
    - Updated `agents.js` to fetch and aggregate data from `caseProgress` subcollection.

## v2.1
- **Voiceless Caller Case**: 
    - Implemented secure password access ("swadmins123").
    - Added "Kalamassery" to "Signal Triangulated" text update.
    - Implemented direct dashboard access for active cases.
    - Added "Find Nearest Unit" workflow with map animation.
    - Refined AI chat logic to be dependent on player instructions.
    - Added mobile responsiveness (vertical stacking, auto-scroll).
- **General**:
    - Added version number display to Case Dashboard and Agents page.
    - Implemented cache busting for script files.

## v2.0
- **Blackwood Manor Case**:
    - Full game loop implementation.
    - "Found Killer" logic and victory condition.
    - Evidence Locker implementation.
- **Dashboard**:
    - Case progress tracking with Firestore.
    - Sticky header and sidebar navigation.
