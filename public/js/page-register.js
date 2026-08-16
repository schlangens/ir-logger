import { initRegister, initGoogleSignIn } from './auth.js';

initRegister(document.getElementById('register-form'));
initGoogleSignIn();
