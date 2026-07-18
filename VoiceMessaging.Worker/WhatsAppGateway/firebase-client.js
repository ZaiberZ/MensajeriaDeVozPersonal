const { requireEnvironment } = require("./environment");

const firebaseBaseUrl = requireEnvironment("VOICE_MESSAGING_FIREBASE_URL").replace(/\/$/, "");
let idToken = "";
let expiresAt = 0;
let authenticationPromise = null;

async function authenticate(force = false) {
    if (!force && idToken && expiresAt > Date.now() + 5 * 60 * 1000)
        return idToken;

    if (!authenticationPromise) {
        authenticationPromise = signIn().finally(() => {
            authenticationPromise = null;
        });
    }

    return authenticationPromise;
}

async function signIn() {
    const apiKey = requireEnvironment("VOICE_MESSAGING_FIREBASE_API_KEY");
    const response = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email: requireEnvironment("VOICE_MESSAGING_FIREBASE_EMAIL"),
                password: requireEnvironment("VOICE_MESSAGING_FIREBASE_PASSWORD"),
                returnSecureToken: true
            })
        });

    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(`Firebase Authentication respondió HTTP ${response.status}: ${body.error?.message || "error desconocido"}.`);
    }

    const result = await response.json();
    idToken = result.idToken || "";
    expiresAt = Date.now() + (Number(result.expiresIn) || 3600) * 1000;

    if (!idToken)
        throw new Error("Firebase Authentication no devolvió un ID token.");

    return idToken;
}

function authenticatedUrl(url, token) {
    const parsed = new URL(url);
    parsed.searchParams.set("auth", token);
    return parsed.toString();
}

async function firebaseFetch(url, options = {}) {
    let response = await fetch(authenticatedUrl(url, await authenticate()), options);

    if (response.status === 401) {
        idToken = "";
        expiresAt = 0;
        response = await fetch(authenticatedUrl(url, await authenticate(true)), options);
    }

    return response;
}

module.exports = { firebaseBaseUrl, firebaseFetch };
