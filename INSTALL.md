# Installation Guide

## 1. Backend Setup

1. Open your terminal and navigate to the `backend` directory:
   ```bash
   cd backend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy the `.env.example` file to `.env`:
   ```bash
   cp .env.example .env
   ```
4. Edit the `.env` file and add your actual API keys:
   - `OPENROUTER_API_KEY`: Get from OpenRouter.ai
   - `ELEVENLABS_API_KEY`: Get from ElevenLabs.io
5. Start the backend server:
   ```bash
   npm start
   ```
   The server will run on `http://localhost:3001`.

## 2. Extension Setup

1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** (toggle switch in the top right corner).
3. Click **Load unpacked**.
4. Select the `extension` directory from this project.
5. The PATHPILOT extension should now appear in your list of extensions.

## 3. Activation

1. Click the PATHPILOT icon in your Chrome toolbar to open the popup.
2. Enter your goal (e.g., "Learn React Hooks").
3. Click **ACTIVATE PATHPILOT**.
4. Click **Open Full Panel** to view the cyberpunk mission control UI.
5. Browse the web! PATHPILOT will monitor your activity and guide you towards your goal.
