// bot.js

import https from 'https';
import dns from 'dns';
import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import { handleCallback } from './callbackHandlers.js';
import {
    handlePhotoDocument,
    handleSticker,
    handleText
} from './messageHandlers.js';
import {
    handleStart,
    handleHelp,
    handleCancel,
    handleStatus
} from './commandHandlers.js';
import { initDatabase } from './databaseManager.js';
import { getSystemSpec } from './configurator.js';

dns.setDefaultResultOrder('ipv4first');

// Load environment variables
dotenv.config();

// Enhanced logger
function logWithContext(context, message, error = null) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${context}] ${message}`);
    if (error) {
        console.error(`[${timestamp}] [${context}] ERROR: ${error.message}`);
        console.error(error.stack);
    }
}

async function testNetworkConnectivity() {
    const { promisify } = await import('util');
    const lookup = promisify(dns.lookup);
    
    try {
        logWithContext('network', 'Testing connectivity...');
        const result = await lookup('api.telegram.org', { family: 4 });
        
        // Test basic HTTPS connection
        await new Promise((resolve, reject) => {
            const req = https.get('https://api.telegram.org/', {
                family: 4,
                timeout: 10000
            }, (res) => {
                res.on('data', () => {});
                res.on('end', resolve);
            });
            
            req.on('error', reject);
            req.setTimeout(10000, () => {
                req.destroy();
                reject(new Error('Connection timeout'));
            });
        });
        
        return true;
    } catch (err) {
        logWithContext('network', 'Network connectivity test failed', err);
        return false;
    }
}

// Test bot token using built-in https module (IPv4-only)
async function testBotToken() {
    if (!process.env.BOT_TOKEN) {
        throw new Error('BOT_TOKEN environment variable is not set');
    }
    
    logWithContext('bot', 'Validating bot token...');
    
    return new Promise((resolve, reject) => {
        const url = `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getMe`;
        
        const req = https.get(url, {
            family: 4,
            timeout: 15000
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    if (result.ok) {
                        logWithContext('bot', `Bot token good: @${result.result.username}`);
                        resolve(true);
                    } else {
                        reject(new Error(`API returned error: ${result.description}`));
                    }
                } catch (parseErr) {
                    reject(new Error(`Invalid JSON response: ${parseErr.message}`));
                }
            });
        });
        
        req.on('error', (err) => {
            logWithContext('bot', 'Bot token validation failed', err);
            reject(err);
        });
        
        req.setTimeout(15000, () => {
            req.destroy();
            reject(new Error('Bot token validation timeout'));
        });
    });
}

// Create IPv4 HTTPS agent
const ipv4Agent = new https.Agent({
    family: 4,           // Force IPv4
    keepAlive: true,
    keepAliveMsecs: 30000,
    timeout: 30000,
    maxSockets: 10,
    maxFreeSockets: 10
});

// Initialize bot
const bot = new Telegraf(process.env.BOT_TOKEN, {
    telegram: {
        agent: ipv4Agent,
        apiRoot: 'https://api.telegram.org',
        webhookReply: false
    },
    handlerTimeout: 120000  // 2 minutes for video processing
});

// Initialize database and system detection
initDatabase().then(async () => {
    logWithContext('bot', 'Database initialized');

    // Validate bot token
    try {
        await testBotToken();
    } catch (err) {
        logWithContext('bot', 'Bot token validation failed', err);
        process.exit(1);
    }

    try {
        // Initialize system specs (this will cache them in configurator.js)
        const spec = await getSystemSpec();

        logWithContext('bot', `System: ${spec.summary.platform}`);
        logWithContext('bot', `FFmpeg: ${spec.ffmpeg.available ? 'Available' : 'Not available'}`);
        
        if (spec.system.isRaspberryPi) {
            logWithContext('bot', `Raspberry Pi detected: ${spec.system.piModel || 'Unknown model'}`);
        }
    } catch (err) {
        logWithContext('bot', 'Failed to initialize system specs', err);
    }
}).catch(err => {
    logWithContext('bot', 'Failed to initialize database', err);
    process.exit(1);
});

// Register command handlers
bot.start(handleStart);
bot.help(handleHelp);
bot.command('cancel', handleCancel);
bot.command('status', handleStatus);

// Register callback handler
bot.on('callback_query', handleCallback);

// Register message handlers for media
bot.on(['photo', 'document'], handlePhotoDocument);

// Handle video messages
bot.on('video', async (ctx) => {
    try {
        return handlePhotoDocument(ctx);
    } catch (err) {
        return ctx.reply('Error processing video.');
    }
});


// Handle animations/GIFs
bot.on('animation', async (ctx) => {
    try {
        return handlePhotoDocument(ctx);
    } catch (err) {
        return ctx.reply('Error processing animation.');
    }
});

// Handle stickers
bot.on('sticker', handleSticker);

// Handle text messages
bot.on('text', handleText);

// Add error handler
bot.catch(async (err, ctx) => {
    logWithContext('bot', `Error for ${ctx.updateType}`, err);

    let errorMessage = 'An error occurred. Please try again or use /start to restart.';

    try {
        const spec = await getSystemSpec();

        if (err.message.includes('ffmpeg') || err.message.includes('video')) {
            if (!spec || !spec.ffmpeg.available) {
                errorMessage = '❌ Video processing error.';
            } else {
                errorMessage = '❌ Video processing error.';
            }
        } else if (err.message.includes('file size') || err.message.includes('too large')) {
            errorMessage = '📁 File too large. (max 50MB).';
        } else if (err.message.includes('format') || err.message.includes('unsupported')) {
            errorMessage = '🚫 Unsupported file format. Please use images (JPEG, PNG, WebP) or videos (MP4, GIF, WebM).';
        }
    } catch (statusErr) {
        // Ignore status errors
    }

    ctx.reply(errorMessage);
});

// Launch bot
async function startBot() {
    // Test network connectivity first
    const networkOk = await testNetworkConnectivity();
    if (!networkOk) {
        logWithContext('bot', 'Network test failed, but attempting to continue...');
    }
    
    let retries = 5;
    while (retries > 0) {
        try {
            logWithContext('bot', `Launching bot... (attempt ${6 - retries})`);
            
            await bot.launch({ 
                dropPendingUpdates: true,
                timeout: 60000,
                allowedUpdates: []
            });
            
            logWithContext('bot', 'Bot launched successfully');
            
            // Verify bot is working
            try {
                const me = await bot.telegram.getMe();
                logWithContext('bot', `Bot ready: @${me.username}`);
            } catch (verifyErr) {
                logWithContext('bot', 'Bot verification failed but continuing', verifyErr);
            }
            
            break;
        } catch (err) {
            retries--;
            logWithContext('bot', `Launch failed, retries left: ${retries}`, err);
            
            if (retries > 0) {
                const waitTime = (6 - retries) * 2000; // Progressive backoff
                logWithContext('bot', `Waiting ${waitTime}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                
                // Try with fresh agent on retry
                if (retries <= 2) {
                    bot.telegram.options.agent = new https.Agent({
                        family: 4,
                        keepAlive: false,
                        timeout: 60000
                    });
                }
            } else {
                logWithContext('bot', 'All launch attempts failed');
                throw err;
            }
        }
    }
}

// Start bot
startBot();

// Enable graceful stop
process.once('SIGINT', () => {
    logWithContext('bot', 'Received SIGINT, stopping bot');
    bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
    logWithContext('bot', 'Received SIGTERM, stopping bot');
    bot.stop('SIGTERM');
});
