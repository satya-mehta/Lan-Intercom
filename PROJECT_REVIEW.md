# Project Review: Intercom Video Call

## 1. Current Functionality

The project appears to implement a browser-based WebRTC video calling application with a signaling server.

Key features:
- Client-side video capture and local preview
- WebRTC peer connection establishment using `offer`, `answer`, and ICE candidates
- Socket.IO-based signaling server on Node/Express
- Online user list and manual call invitation workflow
- Session join/leave events and participant updates
- Local controls for microphone/camera mute and draggable local preview
- Incoming call popup and invitation reject/accept flow

## 2. Project Structure and Actual Serving Path

There is a significant structure mismatch:
- `server/signaling-server.js` is the main server file referenced by `package.json`
- The server uses `express.static('public')`
- The root-level `public/` contained only a minimal video call page.
- The richer UI and logic live under `server/public/`.

This caused a stale duplicate asset folder and deployment confusion. The root-level `public/` folder has been removed to make the active UI folder explicit.

## 3. Weaknesses and Breakage Points

### 3.1. Incomplete or inconsistent configuration
- Root `README.md` is empty.
- Two `package.json` files with inconsistent metadata, scripts, and dependencies.
- `server/package.json` is missing `socket.io` while `server/signaling-server.js` depends on it.
- TLS config in `server/signaling-server.js` requires `server.key` and `server.crt`, but no generation instructions or fallback are provided.
- The app contains a hardcoded device signal URL: `http://192.168.82.196/incomingCall`.

### 3.2. Server/client deployment mismatch
- The server static path likely points to the wrong folder.
- There is duplicate `public/index.html` files with different functionality.
- This will cause confusion and breaks on deployment or testing.

### 3.3. Signaling and session logic issues
- `assignNegotiations()` creates pairwise offer assignments for every participant pair, which may not scale or handle race conditions cleanly.
- The server and client do not appear to manage session state robustly for multi-user calls.
- Invitations and rejects are handled with minimal state; a rejected invite does not clear a call attempt state fully.
- `currentSessionId` is not always reset consistently after leaving or rejecting.

### 3.4. UX and reliability problems
- No loading state when media permission is blocked except an alert.
- No fallback when the remote user declines or connection fails.
- No room/session naming or clear indication of current call participants.
- No reconnection or error recovery for signaling server disconnects.
- User list uses numeric socket IDs instead of readable names in some UI elements.

### 3.5. Security and deployment concerns
- Use of HTTPS with local certs is not documented and will fail if cert files are missing.
- Open CORS origin `*` with credentials may be too permissive for production.
- Signaling server runs on HTTPS but client `axios` call is hardcoded to HTTP.

## 4. Recommended Improvements

### 4.1. Fix project structure and deployment
- Standardize on a single public app folder, ideally `server/public/`.
- Update `server/signaling-server.js` to serve the correct static directory: `express.static(path.join(__dirname, 'public'))`.
- Clean up `package.json` files: either keep one root manifest or clearly document a monorepo setup.
- Add `socket.io` to `server/package.json` if the server folder is used independently.

### 4.2. Improve documentation
- Populate `README.md` with launch instructions, dependencies, and architecture overview.
- Document required TLS files or provide a development fallback to HTTP.
- Add comments for hardcoded endpoints such as the external device signal.

### 4.3. Harden signaling and session flow
- Add server-side session validation and host logic.
- Use named session IDs or room names instead of generated `room-...` strings only.
- Simplify negotiation by making a single participant the caller or using a star topology instead of all pairwise negotiations.
- Add explicit state for pending invites and join responses.

### 4.4. Improve UI/UX
- Show clear status messages for "Calling", "Waiting for user", and "Call ended".
- Display remote participant names, not socket IDs.
- Add a visible participant list and session status in the active call UI.
- Allow users to cancel outgoing invitations before the other party answers.

### 4.5. Fix real-time and connection handling
- Add retry or fallback for ICE candidate failures.
- Close stale peer connections cleanly when a remote user disconnects.
- Add `pc.onconnectionstatechange` handlers to detect failures.
- Handle `socket.on('disconnect')` on the client and show a reconnection prompt.

### 4.6. Clean up hardcoded or environment-specific behavior
- Remove or externalize `axios.get('http://192.168.82.196/incomingCall')`.
- If an external device integration is required, make the URL configurable.
- Do not rely on cookies as the only identity storage; add a clear login/username screen.

## 5. Quick Fix Checklist

1. ✅ Update server static path:
   - Use `path.join(__dirname, 'public')` in `server/signaling-server.js`
2. ✅ Consolidate `package.json` dependencies and scripts.
3. ✅ Add missing `socket.io` dependency to `server/package.json` if needed.
4. ✅ Document TLS requirement or allow HTTP in development.
5. ✅ Remove the unused top-level `public/index.html` or merge it with `server/public/index.html`.
6. ✅ Replace hardcoded IP-based external call trigger with configurable setting or remove it.
7. ✅ Add a `README.md` section for startup commands and required assets.

## 6. Further Improvements Checklist

- Improve multi-user negotiation and session state handling for larger rooms.
- Add server-side validation for pending invites and reject/accept flow.
- Display participant names and session status in the active call UI.
- Add `pc.onconnectionstatechange` and better ICE retry handling in the client.
- Restrict CORS in production instead of using `*`.
- Add explicit configuration support for external device signaling.
- Add better error handling and reconnection logic for socket disconnects.

## 7. Suggested Next Step

The highest-impact fix is to make the server serve the correct front-end and ensure the app runs end-to-end from one entrypoint.
Once that is stable, iterate on session state, multi-user negotiation, and UX polish.
