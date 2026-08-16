import { initRegister, initGoogleSignIn, initRegistrationGate } from './auth.js';

initRegister(document.getElementById('register-form'));
initGoogleSignIn();
initRegistrationGate();
