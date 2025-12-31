# Version History

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
