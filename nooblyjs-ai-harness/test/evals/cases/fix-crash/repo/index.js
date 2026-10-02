import { loadSettings } from './settings.js';

const settings = loadSettings();
console.log(`port=${settings.port} host=${settings.host}`);
