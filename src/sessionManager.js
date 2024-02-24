const sessions = {};

function getSession(chatId) {
    if (!sessions[chatId]) {
        sessions[chatId] = { lastAction: null, images: [], messageId: null, timestamp: new Date() };
    }
    return sessions[chatId];
}

function purgeSessions() {
    const now = new Date();
    Object.keys(sessions).forEach(chatId => {
        if (now - sessions[chatId].timestamp > 21600000) { // 6 hours in milliseconds
            delete sessions[chatId];
            // Additionally, delete any saved images related to this session from local storage
        }
    });
}

setInterval(purgeSessions, 3600000); // Run every hour

module.exports = { getSession };
