import { initLogin, initGoogleSignIn, initRegistrationGate } from './auth.js';

initLogin(document.getElementById('login-form'));
initGoogleSignIn();
initRegistrationGate();
