import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const siteDir = join(__dirname, 'site');

// CORS for all routes
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Root path redirection: ensure Expo Router initializes with the expected baseUrl
app.use((req, res, next) => {
  if (req.path === '/' || req.originalUrl === '/FeedPulse-AI-Web') {
    return res.redirect(302, '/FeedPulse-AI-Web/');
  }
  if (req.originalUrl === '/settings') {
    return res.redirect(302, '/FeedPulse-AI-Web/settings');
  }
  next();
});

// Firebase Applet Config
app.get(['/firebase-applet-config.json', '/FeedPulse-AI-Web/firebase-applet-config.json'], (req, res) => {
  res.sendFile(join(__dirname, 'firebase-applet-config.json'));
});

// Auth / Sign In page
app.get(['/login', '/FeedPulse-AI-Web/login'], (req, res) => {
  res.sendFile(join(siteDir, 'auth.html'));
});

// Topic Selection / Preferences onboarding page
app.get(['/preferences', '/FeedPulse-AI-Web/preferences'], (req, res) => {
  res.sendFile(join(siteDir, 'preferences.html'));
});

// Serve static assets from site directory for both prefixes
app.use('/FeedPulse-AI-Web', express.static(siteDir));
app.use(express.static(siteDir));

// Fallback for /FeedPulse-AI-Web SPA routes
app.get('/FeedPulse-AI-Web/*', (req, res) => {
  res.sendFile(join(siteDir, 'index.html'));
});

// General SPA fallback
app.get('*', (req, res) => {
  res.sendFile(join(siteDir, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`FeedPulse AI server running at http://0.0.0.0:${PORT}`);
});
