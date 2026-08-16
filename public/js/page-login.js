import { initLogin, initGoogleSignIn } from './auth.js';

initLogin(document.getElementById('login-form'));
initGoogleSignIn();
