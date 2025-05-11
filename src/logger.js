// logger.js - Enhanced logging system with multiple levels

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
  fileLevel: LOG_LEVELS.INFO,
  logToFile: true,
  logToConsole: true,
  colorize: true
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
const rootDir = path.join(__dirname, '..');
const logsDir = path.join(rootDir, 'logs');

// Ensure logs directory exists
try {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
} catch (err) {
  console.error(`Failed to create logs directory: ${err.message}`);
}

/**
 * Set logger configuration
 * @param {object} options - Configuration options
 */
function configure(options = {}) {
  Object.assign(config, options);
}

/**
 * Format a log message
 * @param {string} level - Log level
 * @param {string} context - Context identifier
 * @param {string} message - Log message
 * @param {Error|null} error - Optional error object
 * @returns {string} Formatted log message
 */
function formatLogMessage(level, context, message, error = null) {
  const timestamp = new Date().toISOString();
  let logMessage = `[${timestamp}] [${level}] [${context}] ${message}`;
  
  if (error) {
    logMessage += `\n  Error: ${error.message}`;
    if (error.stack) {
      logMessage += `\n  Stack: ${error.stack}`;
    }
  }
  
  return logMessage;
}

/**
 * Format a console message with colors
 * @param {string} level - Log level
 * @param {string} context - Context identifier
 * @param {string} message - Log message
 * @param {Error|null} error - Optional error object
 * @returns {string} Colorized message for console
 */
function formatColorizedMessage(level, context, message, error = null) {
  const timestamp = new Date().toISOString();
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
  
  let logMessage = `${COLORS.dim}[${timestamp}]${COLORS.reset} ${color}[${level}]${COLORS.reset} ${COLORS.cyan}[${context}]${COLORS.reset} ${message}`;
  
  if (error) {
    logMessage += `\n  ${COLORS.red}Error: ${error.message}${COLORS.reset}`;
    if (error.stack) {
      logMessage += `\n  ${COLORS.gray}Stack: ${error.stack}${COLORS.reset}`;
    }
  }
  
  return logMessage;
}

/**
 * Write log to file
 * @param {string} message - Formatted log message
 */
function writeToFile(message) {
  if (!config.logToFile) return;
  
  try {
    const date = new Date().toISOString().split('T')[0];
    const logFile = path.join(logsDir, `${date}.log`);
    
    fs.appendFileSync(logFile, message + '\n');
  } catch (err) {
    console.error(`Failed to write to log file: ${err.message}`);
  }
}

/**
 * Log a message at a specific level
 * @param {string} level - Log level (DEBUG, INFO, WARN, ERROR)
 * @param {string} context - Context identifier
 * @param {string} message - Log message
 * @param {Error|null} error - Optional error object
 */
function log(level, context, message, error = null) {
  const levelValue = LOG_LEVELS[level] ?? LOG_LEVELS.INFO;
  
  // Log to file if level is sufficient
  if (levelValue >= config.fileLevel) {
    const fileMessage = formatLogMessage(level, context, message, error);
    writeToFile(fileMessage);
  }
  
  // Log to console if level is sufficient
  if (config.logToConsole && levelValue >= config.consoleLevel) {
    const consoleMessage = config.colorize 
      ? formatColorizedMessage(level, context, message, error)
      : formatLogMessage(level, context, message, error);
    
    if (level === 'ERROR') {
      console.error(consoleMessage);
    } else if (level === 'WARN') {
      console.warn(consoleMessage);
    } else {
      console.log(consoleMessage);
    }
  }
}

// Create specific level logging functions
const debug = (context, message, error = null) => log('DEBUG', context, message, error);
const info = (context, message, error = null) => log('INFO', context, message, error);
const warn = (context, message, error = null) => log('WARN', context, message, error);
const error = (context, message, error = null) => log('ERROR', context, message, error);

// Legacy function for backward compatibility
function logWithContext(context, message, error = null) {
  return info(context, message, error);
}

// Export all functions
export {
  debug,
  info,
  warn,
  error,
  configure,
  logWithContext, // Legacy function
  LOG_LEVELS
};