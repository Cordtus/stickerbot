// utils.js - Consolidated utility functions

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { logWithContext } from './logger.js';

// Path constants - setup on module load
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const srcDir = __dirname;
const dataDir = path.join(srcDir, 'data');
const tempDir = path.join(srcDir, 'temp');
const logsDir = path.join(rootDir, 'logs');

// Initialize critical directories
ensureDirectory(dataDir);
ensureDirectory(tempDir);
ensureDirectory(logsDir);

// ==============================================
// PATH & FILE UTILITIES
// ==============================================

/**
 * Ensures a directory exists, creating it if necessary
 * @param {string} dirPath - Path to ensure exists
 * @returns {string} The validated directory path
 */
function ensureDirectory(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      logWithContext('utils', `Created directory: ${dirPath}`);
    }
    return dirPath;
  } catch (err) {
    logWithContext('utils', `Failed to create directory: ${dirPath}`, err);
    throw err;
  }
}

/**
 * Gets a path relative to the project root
 * @param {...string} pathSegments - Path segments to join
 * @returns {string} The full path
 */
function getProjectPath(...pathSegments) {
  return path.join(rootDir, ...pathSegments);
}

/**
 * Gets a path relative to the src directory
 * @param {...string} pathSegments - Path segments to join
 * @returns {string} The full path
 */
function getSrcPath(...pathSegments) {
  return path.join(srcDir, ...pathSegments);
}

/**
 * Gets a path relative to the data directory
 * @param {...string} pathSegments - Path segments to join
 * @returns {string} The full path
 */
function getDataPath(...pathSegments) {
  ensureDirectory(dataDir);
  return path.join(dataDir, ...pathSegments);
}

/**
 * Gets a path relative to the temp directory
 * @param {...string} pathSegments - Path segments to join
 * @returns {string} The full path
 */
function getTempPath(...pathSegments) {
  ensureDirectory(tempDir);
  return path.join(tempDir, ...pathSegments);
}

/**
 * Gets a path relative to the logs directory
 * @param {...string} pathSegments - Path segments to join
 * @returns {string} The full path
 */
function getLogsPath(...pathSegments) {
  ensureDirectory(logsDir);
  return path.join(logsDir, ...pathSegments);
}

/**
 * Check if a file is an image based on extension
 * @param {string} filename - Filename to check
 * @returns {boolean} - Whether file is an image
 */
function isImageFile(filename) {
  if (!filename) return false;
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.tiff'];
  const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
  return imageExtensions.includes(ext);
}

// ==============================================
// SECURITY UTILITIES
// ==============================================

/**
 * Sanitizes user input to prevent path traversal attacks
 * @param {string} input - User input that will be part of a path
 * @returns {string} Sanitized string
 */
function sanitizeFilename(input) {
  // Remove any problematic characters, allow only alphanumeric, underscore, hyphen, and period
  return input.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
}

/**
 * Safe path resolution that prevents path traversal attacks
 * @param {string} directory - Base directory (safe)
 * @param {string} filename - Potentially unsafe filename from user input
 * @returns {string} Sanitized path
 */
function safePathJoin(directory, filename) {
  const sanitized = sanitizeFilename(filename);
  
  // Ensure the resulting path stays within the intended directory
  const fullPath = path.join(directory, sanitized);
  
  // Extra safety check - make sure the normalized path still starts with our base directory
  const normalizedPath = path.normalize(fullPath);
  const normalizedDir = path.normalize(directory);

  if (!normalizedPath.startsWith(normalizedDir)) {
    logWithContext('utils', `Attempted path traversal detected: ${filename} -> ${fullPath}`);
    throw new Error('Invalid filename');
  }
  
  return fullPath;
}

/**
 * Validates SQL identifiers to prevent SQL injection
 * @param {string} identifier - SQL identifier to validate
 * @returns {boolean} Whether the identifier is valid
 */
function isValidSqlIdentifier(identifier) {
  // SQL identifiers should only contain alphanumeric and underscores
  const validPattern = /^[a-zA-Z0-9_]+$/;
  return validPattern.test(identifier);
}

// ==============================================
// TELEGRAM-SPECIFIC UTILITIES
// ==============================================

/**
 * Validates a sticker pack name according to Telegram's rules
 * @param {string} name - Pack name to validate 
 * @returns {boolean} Whether the name is valid
 */
function isValidStickerSetName(name) {
  // Telegram sticker set names must be 1-64 characters, lowercase, and contain only a-z, 0-9, and _
  const validPattern = /^[a-z0-9_]{1,64}$/;
  return validPattern.test(name);
}

/**
 * Validates a Telegram username
 * @param {string} username - Username to validate
 * @returns {boolean} Whether the username is valid
 */
function isValidTelegramUsername(username) {
  // Telegram usernames are 5-32 characters and contain only letters, numbers, and underscores
  const validPattern = /^[a-zA-Z0-9_]{5,32}$/;
  return validPattern.test(username);
}

/**
 * Generate a valid sticker set name from a user-friendly title
 * @param {object} ctx - Telegram context
 * @param {string} title - User-friendly title for the sticker pack
 * @returns {string} - Valid sticker set name for Telegram API
 */
function generateStickerSetName(ctx, title) {
  // Remove non-alphanumeric characters and convert to lowercase
  const base = sanitizeStickerSetName(title);
  
  // Add bot username suffix as required by Telegram
  const botUsername = ctx.botInfo.username;
  const randomSuffix = Math.floor(Math.random() * 1000);
  
  const name = `${base}_${randomSuffix}_by_${botUsername}`;
  logWithContext('utils', `Generated name "${name}" from title "${title}"`);
  
  return name;
}

/**
 * Sanitizes a string to be used as a sticker set name
 * @param {string} input - String to sanitize
 * @returns {string} - Sanitized string
 */
function sanitizeStickerSetName(input) {
  // Remove any non-alphanumeric characters, convert to lowercase
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .substring(0, 40); // Telegram has a length limit
}

/**
 * Extract sticker set name from Telegram link or text
 * @param {string} input - Input text (URL or pack name)
 * @returns {string|null} - Extracted sticker set name or null if invalid
 */
function extractStickerSetName(input) {
  if (!input) return null;
  
  // Clean up the input
  const trimmed = input.trim();
  
  // Direct pack name
  if (isValidStickerSetName(trimmed)) {
    return trimmed;
  }
  
  // Handle URLs like https://t.me/addstickers/packname
  const urlRegex = /(?:https?:\/\/)?(?:t(?:elegram)?\.(?:me|dog)\/addstickers\/([a-z0-9_]+))/i;
  const match = trimmed.match(urlRegex);
  
  if (match && match[1]) {
    return match[1];
  }
  
  return null;
}

// ==============================================
// ID & DATE UTILITIES
// ==============================================

/**
 * Generate a non-sequential unique ID
 * @param {string} prefix - Prefix for the ID
 * @returns {string} - Random ID
 */
function generateRandomId(prefix = '') {
  // Generate a UUID-like string using Math.random()
  const randomPart = Math.random().toString(36).substring(2, 15) + 
                     Math.random().toString(36).substring(2, 15);
  const timestamp = Date.now().toString(36);
  
  return `${prefix}${timestamp}${randomPart}`;
}

/**
 * Generates a unique filename with a timestamp
 * @param {string} prefix - Prefix for the filename
 * @param {string} extension - File extension (without the dot)
 * @param {string|number} userId - Optional user ID to include
 * @returns {string} A unique filename
 */
function generateUniqueFilename(prefix, extension, userId = '') {
  const timestamp = Date.now();
  const userPart = userId ? `${userId}-` : '';
  return `${prefix}-${userPart}${timestamp}.${extension}`;
}

/**
 * Format a date for display or filename usage
 * @param {Date} date - Date to format
 * @param {string} format - Format style ('filename', 'display', 'iso', or 'short')
 * @returns {string} - Formatted date string
 */
function formatDate(date, format = 'short') {
  if (!date) date = new Date();
  
  switch (format) {
    case 'filename':
      return date.toISOString().replace(/[:\-T]/g, '').split('.')[0];
    case 'iso':
      return date.toISOString();
    case 'display':
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    case 'short':
    default:
      return date.toISOString().split('T')[0];
  }
}

// Export all utilities
export {
  // Constants
  rootDir,
  srcDir,
  dataDir,
  tempDir,
  logsDir,
  
  // Path & File utilities
  ensureDirectory,
  getProjectPath,
  getSrcPath,
  getDataPath,
  getTempPath,
  getLogsPath,
  isImageFile,
  
  // Security utilities
  sanitizeFilename,
  safePathJoin,
  isValidSqlIdentifier,
  
  // Telegram utilities
  isValidStickerSetName,
  isValidTelegramUsername,
  generateStickerSetName,
  sanitizeStickerSetName,
  extractStickerSetName,
  
  // ID & Date utilities
  generateRandomId,
  generateUniqueFilename,
  formatDate
};