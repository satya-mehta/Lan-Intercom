# Intercom Video Call

## Setup

1. Install dependencies from the repository root:
   ```powershell
   npm install
   ```

2. Start the signaling server:
   ```powershell
   npm start
   ```

3. Open the browser at the server URL shown in the console.

## Project Layout

- `server/signaling-server.js` - main Node.js signaling server.
- `server/public/` - front-end UI, styles, and WebRTC client logic.
- `server/package.json` - server-specific dependency metadata.
- `PROJECT_REVIEW.md` - review notes, implemented fixes, and remaining improvements.

## Notes

- The server now serves static assets from `server/public` using an absolute path.
- If `server/server.key` and `server/server.crt` are missing, the server falls back to HTTP for local development.
- The client can optionally use an external device signal endpoint by setting `DEVICE_SIGNAL_URL` in `server/public/scripts/main.js`.
- The root-level `public/` folder was removed because the active app is served from `server/public/`.

## Development

- `server/package.json` includes the required server-side dependencies.
- Use the same root `npm install` if you want to install dependencies for the complete project.
