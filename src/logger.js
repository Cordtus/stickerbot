// logger.js

/**
 * Enhanced logger with context information
 * @param {string} context - The context/module name 
 * @param {string} message - Log message
 * @param {Error|null} error - Optional error object
 */
function logWithContext(context, message, error = null) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${context}] ${message}`);
  if (error) {
      console.error(`[${timestamp}] [${context}] ERROR: ${error.message}`);
      console.error(error.stack);
  }
}

export { logWithContext };