// logger.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Constants
const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

// Default configuration
const config = {
  consoleLevel: process.env.NODE_ENV === 'production' ? LOG_LEVELS.INFO : LOG_LEVELS.DEBUG,
  fileLevel: LOG_LEVELS.DEBUG,
  logToFile: true,
  logToConsole: true,
  colorize: true,
  maxFileSize: 10 * 1024 * 1024,
  maxFiles: 5,
  rotateDaily: true
};

// Colors for console output
const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

// Path setup
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const logsDir = path.join(rootDir, 'logs');

// Ensure logs directory exists
try {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
    console.log(`📁 Created logs directory: ${logsDir}`);
  }
} catch (err) {
  console.error(`❌ Failed to create logs directory: ${err.message}`);
}

// Current log files
let currentLogFile = null;
let currentErrorFile = null;
let currentDate = null;

/**
 * Get log file paths for current date
 */
function getLogFilePaths() {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  
  if (currentDate !== today) {
    currentDate = today;
    currentLogFile = path.join(logsDir, `bot-${today}.log`);
    currentErrorFile = path.join(logsDir, `error-${today}.log`);
  }
  
  return { logFile: currentLogFile, errorFile: currentErrorFile };
}

/**
 * Rotate log files
 */
function rotateLogFileIfNeeded(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    
    const stats = fs.statSync(filePath);
    if (stats.size > config.maxFileSize) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const rotatedPath = filePath.replace('.log', `-${timestamp}.log`);
      fs.renameSync(filePath, rotatedPath);
      
      // Clean up old files
      cleanupOldFiles(path.dirname(filePath), path.basename(filePath, '.log'));
    }
  } catch (err) {
    console.error(`Error rotating log file: ${err.message}`);
  }
}

/**
 * Clean up log files
 */
function cleanupOldFiles(dir, baseName) {
  try {
    const files = fs.readdirSync(dir)
      .filter(file => file.startsWith(baseName) && file.endsWith('.log'))
      .map(file => ({
        name: file,
        path: path.join(dir, file),
        mtime: fs.statSync(path.join(dir, file)).mtime
      }))
      .sort((a, b) => b.mtime - a.mtime);
    
    if (files.length > config.maxFiles) {
      const filesToDelete = files.slice(config.maxFiles);
      filesToDelete.forEach(file => {
        try {
          fs.unlinkSync(file.path);
        } catch (err) {
          console.error(`Error deleting old log file ${file.name}: ${err.message}`);
        }
      });
    }
  } catch (err) {
    console.error(`Error cleaning up old files: ${err.message}`);
  }
}

/**
 * Format log msg
 */
function formatLogMessage(level, context, message, error = null, metadata = {}) {
  const timestamp = new Date().toISOString();
  let logObj = {
    timestamp,
    level,
    context,
    message,
    pid: process.pid
  };
  
  // Add metadata
  if (Object.keys(metadata).length > 0) {
    logObj.metadata = metadata;
  }
  
  // Add error details
  if (error) {
    logObj.error = {
      message: error.message,
      name: error.name,
      stack: error.stack,
      code: error.code,
      errno: error.errno
    };
  }
  
  return logObj;
}

/**
 * Format console logs
 */
function formatConsoleMessage(logObj) {
  const { timestamp, level, context, message, error } = logObj;
  let color;
  
  switch (level) {
    case 'DEBUG':
      color = COLORS.gray;
      break;
    case 'INFO':
      color = COLORS.green;
      break;
    case 'WARN':
      color = COLORS.yellow;
      break;
    case 'ERROR':
      color = COLORS.red;
      break;
    default:
      color = COLORS.reset;
  }
  
  let consoleMessage = `${color}[${timestamp}] [${level}] [${context}]${COLORS.reset} ${message}`;
  
  if (error) {
    consoleMessage += `\n${COLORS.red}  ❌ ${error.message}${COLORS.reset}`;
    if (level === 'DEBUG' && error.stack) {
      consoleMessage += `\n${COLORS.dim}  📚 ${error.stack}${COLORS.reset}`;
    }
  }
  
  if (logObj.metadata && Object.keys(logObj.metadata).length > 0) {
    consoleMessage += `\n${COLORS.cyan}  📋 ${JSON.stringify(logObj.metadata)}${COLORS.reset}`;
  }
  
  return consoleMessage;
}

/**
 * Write log to file
 */
function writeToFile(logObj, isError = false) {
  if (!config.logToFile) return;
  
  try {
    const { logFile, errorFile } = getLogFilePaths();
    const targetFile = isError ? errorFile : logFile;
    
    // Rotate if needed
    rotateLogFileIfNeeded(targetFile);
    
    // Write log entry
    const logLine = JSON.stringify(logObj) + '\n';
    fs.appendFileSync(targetFile, logLine);
    
    // Also write errors to main log file
    if (isError && targetFile !== logFile) {
      fs.appendFileSync(logFile, logLine);
    }
  } catch (err) {
    console.error(`Failed to write to log file: ${err.message}`);
  }
}

/**
 * Main function
 */
function log(level, context, message, error = null, metadata = {}) {
  const levelNum = LOG_LEVELS[level] || LOG_LEVELS.INFO;
  
  // Create log object
  const logObj = formatLogMessage(level, context, message, error, metadata);
  
  // Console output
  if (config.logToConsole && levelNum >= config.consoleLevel) {
    const consoleMsg = config.colorize ? 
      formatConsoleMessage(logObj) : 
      `[${logObj.timestamp}] [${level}] [${context}] ${message}`;
    
    console.log(consoleMsg);
  }
  
  // File output
  if (config.logToFile && levelNum >= config.fileLevel) {
    writeToFile(logObj, level === 'ERROR');
  }
}

/**
 * Convenience logging
 */
const logger = {
  debug: (context, message, error, metadata) => log('DEBUG', context, message, error, metadata),
  info: (context, message, error, metadata) => log('INFO', context, message, error, metadata),
  warn: (context, message, error, metadata) => log('WARN', context, message, error, metadata),
  error: (context, message, error, metadata) => log('ERROR', context, message, error, metadata),
  
  // Backward compatibility with existing logWithContext function
  logWithContext: (context, message, error = null, metadata = {}) => {
    const level = error ? 'ERROR' : 'INFO';
    log(level, context, message, error, metadata);
  }
};

function logWithContext(context, message, error = null, metadata = {}) {
  const level = error ? 'ERROR' : 'INFO';
  log(level, context, message, error, metadata);
}

/**
 * Log startup messages
 */
function logStartup() {
  const startupInfo = {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
    pid: process.pid,
    workingDirectory: process.cwd()
  };
  
  logger.info('startup', 'Bot starting up', null, startupInfo);
}

/**
 * Log activity
 */
function logUserActivity(userId, username, action, details = {}) {
  const metadata = {
    userId,
    username,
    action,
    ...details
  };
  
  logger.info('user-activity', `User ${username || userId} performed ${action}`, null, metadata);
}

/**
 * Log video processing
 */
function logVideoProcessing(userId, filename, processingTime, inputSize, outputSize, mode) {
  const metadata = {
    userId,
    filename,
    processingTime,
    inputSize,
    outputSize,
    mode,
    compressionRatio: inputSize > 0 ? (outputSize / inputSize).toFixed(2) : 'N/A'
  };
  
  logger.info('video-processing', `Video processed: ${filename}`, null, metadata);
}

/**
 * Log db
 */
function logDatabase(operation, success = true, error = null, details = {}) {
  const metadata = {
    operation,
    success,
    ...details
  };
  
  if (success) {
    logger.info('database', `Database operation: ${operation}`, null, metadata);
  } else {
    logger.error('database', `Database operation failed: ${operation}`, error, metadata);
  }
}

/**
 * Config
 */
function configure(options = {}) {
  Object.assign(config, options);
  logger.info('logger', 'Logger configuration updated', null, { newConfig: config });
}

/**
 * Get config
 */
function getConfig() {
  return { ...config };
}

/**
 * Clean up on start
 */
function cleanup() {
  try {
    ['bot', 'error'].forEach(type => {
      cleanupOldFiles(logsDir, type);
    });
    logger.info('logger', 'Log cleanup completed');
  } catch (err) {
    logger.error('logger', 'Log cleanup failed', err);
  }
}

// Initialize logger
cleanup();
logStartup();

export {
  logger,
  logWithContext,
  logUserActivity,
  logVideoProcessing,
  logDatabase,
  configure,
  getConfig,
  LOG_LEVELS
};