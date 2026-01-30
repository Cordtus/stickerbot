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

export {
  isValidStickerSetName,
  extractStickerSetName
};
