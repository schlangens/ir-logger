import { initApp } from './app.js';
import { initSettings } from './settings.js';

initApp().then(initSettings);
