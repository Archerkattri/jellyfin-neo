const connectForm = document.getElementById('connect-form');
const addressInput = document.getElementById('address');
const connectButton = document.getElementById('connect-button');
const connectionStatus = document.getElementById('connection-status');
const spinner = document.getElementById('spinner');
const connectButtonText = connectButton.getAttribute('data-original-text') || connectButton.textContent;

let isConnecting = false;
let connectionAttempt = 0;

function setConnectionState(state, message = '') {
    const connecting = state === 'connecting';

    connectForm.dataset.state = state;
    connectForm.setAttribute('aria-busy', String(connecting));
    addressInput.disabled = connecting;
    spinner.hidden = !connecting;
    connectionStatus.hidden = !message;
    connectionStatus.dataset.state = state;
    connectionStatus.textContent = message;
    connectButton.classList.toggle('cancel', connecting);
    connectButton.textContent = connecting ? window.cancelButtonText : connectButtonText;
    connectButton.disabled = !connecting && addressInput.value.trim().length === 0;
}

async function tryConnect(server, attempt) {
    try {
        let normalizedServer = server.trim();
        if (!/^https?:\/\//i.test(normalizedServer)) {
            normalizedServer = `http://${normalizedServer}`;
        }

        console.log('Checking connectivity to:', normalizedServer);
        const resolvedUrl = await window.jmpCheckServerConnectivity(normalizedServer);

        // Ignore late responses after Escape or the visible Cancel action.
        if (!isConnecting || attempt !== connectionAttempt) {
            return false;
        }

        console.log('Server connectivity check passed');
        window.jmpInfo.settings.main.userWebClient = normalizedServer;
        window.location = resolvedUrl;
        return true;
    } catch (error) {
        if (isConnecting && attempt === connectionAttempt) {
            console.error('Server connectivity check failed:', error);
        }
        return false;
    }
}

function cancelConnection() {
    if (!isConnecting) {
        return;
    }

    console.log('Cancelling connection');
    isConnecting = false;
    connectionAttempt++;

    if (window.api?.system) {
        window.api.system.cancelServerConnectivity();
    }
    if (window.jmpCheckServerConnectivity.abort) {
        window.jmpCheckServerConnectivity.abort();
    }

    document.removeEventListener('keydown', cancelOnEscape);
    setConnectionState('idle');
    addressInput.focus();
}

function cancelOnEscape(event) {
    if (isConnecting && event.key === 'Escape') {
        event.preventDefault();
        cancelConnection();
    }
}

async function startConnecting(server = addressInput.value) {
    if (isConnecting) {
        cancelConnection();
        return;
    }

    const requestedServer = server.trim();
    if (!requestedServer) {
        setConnectionState('idle');
        addressInput.focus();
        return;
    }

    isConnecting = true;
    const attempt = ++connectionAttempt;
    setConnectionState('connecting', `${connectButtonText}…`);
    document.addEventListener('keydown', cancelOnEscape);

    const connected = await tryConnect(requestedServer, attempt);
    if (connected || attempt !== connectionAttempt) {
        return;
    }

    isConnecting = false;
    document.removeEventListener('keydown', cancelOnEscape);
    setConnectionState('error', window.connectionFailureText);
    addressInput.focus();
}

connectForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (isConnecting) {
        cancelConnection();
    } else {
        void startConnecting();
    }
});

addressInput.addEventListener('input', () => {
    if (!isConnecting) {
        setConnectionState('idle');
    }
});

(async () => {
    console.log('Auto-connect: starting');
    await window.apiPromise;

    const savedServer = window.jmpInfo.settings.main.userWebClient;
    if (savedServer && savedServer.trim()) {
        addressInput.value = savedServer;
        void startConnecting(savedServer);
        return;
    }

    setConnectionState('idle');
    addressInput.focus();
})();
