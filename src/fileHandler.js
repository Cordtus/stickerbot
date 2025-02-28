// fileHandler.js

import fs from 'fs';
import axios from 'axios';
import { logWithContext } from './logger.js';
import { getTempPath, generateUniqueFilename, safePathJoin } from './utils.js';

/**
 * Downloads a file from a URL and saves it locally
 * @param {string} fileLink - URL of the file to download
 * @param {string|number} userId - ID of the user requesting the download
 * @param {string} extension - File extension (without the dot)
 * @returns {Promise<string>} Path to the downloaded file
 */
async function downloadAndSaveFile(fileLink, userId, extension = 'webp') {
  try {
    const filename = generateUniqueFilename('download', extension, userId);
    const filePath = getTempPath(filename);

    logWithContext('fileUtils', `Downloading file from ${fileLink} to ${filePath}`);
    
    const response = await axios({ 
      url: fileLink, 
      responseType: 'stream',
      timeout: 30000 // 30 second timeout
    });
    
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        logWithContext('fileUtils', `File download complete: ${filePath}`);
        resolve(filePath);
      });
      writer.on('error', (err) => {
        logWithContext('fileUtils', `File download failed: ${filePath}`, err);
        safeDeleteFile(filePath);
        reject(err);
      });
    });
  } catch (err) {
    logWithContext('fileUtils', `Error downloading or saving file from ${fileLink}`, err);
    throw err;
  }
}

/**
 * Creates a temporary file from a buffer
 * @param {Buffer} buffer - File data as a Buffer
 * @param {string|number} userId - User ID 
 * @param {string} prefix - Filename prefix
 * @param {string} extension - File extension
 * @returns {string} Path to the created file
 */
function createTempFileFromBuffer(buffer, userId, prefix = 'temp', extension = 'webp') {
  try {
    const filename = generateUniqueFilename(prefix, extension, userId);
    const filePath = getTempPath(filename);
    
    fs.writeFileSync(filePath, buffer);
    logWithContext('fileUtils', `Created temporary file: ${filePath}`);
    
    return filePath;
  } catch (err) {
    logWithContext('fileUtils', `Failed to create temporary file`, err);
    throw err;
  }
}

/**
 * Safely delete a file, handling errors
 * @param {string} filePath - Path to the file to delete
 * @param {string} context - Logging context identifier
 * @returns {boolean} Whether deletion was successful
 */
function safeDeleteFile(filePath, context = 'fileUtils') {
  if (!filePath) return false;
  
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logWithContext(context, `Successfully deleted file: ${filePath}`);
      return true;
    }
    return false;
  } catch (err) {
    logWithContext(context, `Failed to delete file: ${filePath}`, err);
    return false;
  }
}

/**
 * Batch delete multiple files
 * @param {string[]} filePaths - Array of file paths to delete
 * @param {string} context - Logging context identifier
 * @returns {object} Success and failure counts
 */
function batchDeleteFiles(filePaths, context = 'fileUtils') {
  const result = {
    success: 0,
    failure: 0,
    deletedPaths: []
  };
  
  if (!Array.isArray(filePaths) || filePaths.length === 0) return result;
  
  for (const filePath of filePaths) {
    if (safeDeleteFile(filePath, context)) {
      result.success++;
      result.deletedPaths.push(filePath);
    } else {
      result.failure++;
    }
  }
  
  logWithContext(context, `Batch delete complete: ${result.success} succeeded, ${result.failure} failed`);
  return result;
}

/**
 * Cleanup all temporary files older than a certain age
 * @param {string} directory - Directory to clean
 * @param {number} maxAgeHours - Maximum age in hours
 * @returns {object} Results of the cleanup operation
 */
function cleanupOldFiles(directory, maxAgeHours = 6) {
  const result = {
    scanned: 0,
    deleted: 0,
    errors: 0
  };
  
  try {
    if (!fs.existsSync(directory)) {
      logWithContext('fileUtils', `Directory doesn't exist: ${directory}`);
      return result;
    }
    
    const now = Date.now();
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
    const files = fs.readdirSync(directory);
    
    result.scanned = files.length;
    
    for (const file of files) {
      const filePath = safePathJoin(directory, file);
      try {
        const stats = fs.statSync(filePath);
        const fileAge = now - stats.mtimeMs;
        
        if (fileAge > maxAgeMs) {
          safeDeleteFile(filePath, 'fileUtils') ? result.deleted++ : result.errors++;
        }
      } catch (err) {
        result.errors++;
        logWithContext('fileUtils', `Error checking file: ${file}`, err);
      }
    }
    
    logWithContext('fileUtils', `Cleanup complete: ${result.deleted} deleted, ${result.errors} errors, ${result.scanned} total files scanned`);
    return result;
  } catch (err) {
    logWithContext('fileUtils', `Error during cleanup of ${directory}`, err);
    return result;
  }
}

export {
  downloadAndSaveFile,
  createTempFileFromBuffer,
  safeDeleteFile,
  batchDeleteFiles,
  cleanupOldFiles
};