// utils.js

/**
 * Validates if a string is a valid sticker set name
 * @param {string} name - Name to validate
 * @returns {boolean} - Whether name is valid
 */
function isValidStickerSetName(name) {
  // Telegram requirements: only lowercase a-z, 0-9 and underscores
  const validPattern = /^[a-z0-9_]+$/;
  return validPattern.test(name);
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
* Format a date for display
* @param {Date} date - Date to format
* @returns {string} - Formatted date string
*/
function formatDate(date) {
  return date.toISOString().split('T')[0];
}

/**
* Generate a random ID with given prefix
* @param {string} prefix - Prefix for the ID
* @returns {string} - Random ID
*/
function generateRandomId(prefix = '') {
  return `${prefix}${Math.random().toString(36).substring(2, 15)}`;
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

export {
  isValidStickerSetName,
  sanitizeStickerSetName,
  formatDate,
  generateRandomId,
  isImageFile
};